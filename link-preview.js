// Link previews for blog posts. Two pieces, both built from the same data:
//
// 1. Link cards. A paragraph that holds nothing but one link becomes a card
//    with an image, title, description and meta line:
//
//        [weightspace-watermarking](https://github.com/owner/repo)
//
// 2. Hover previews. Any other outbound link in the post shows a small
//    floating preview on hover or keyboard focus (pointer devices only).
//
// GitHub repos are filled in from the GitHub API (description, stars,
// language) plus GitHub's social image. Other links use the link's text as the
// title and its Markdown title as the description:
//
//        [Some paper](https://example.com/paper "One line about it")

(() => {
  const CACHE_PREFIX = "link-preview:";
  const pending = new Map();

  function githubRepo(url) {
    if (url.hostname !== "github.com") return null;
    const [owner, repo] = url.pathname.split("/").filter(Boolean);
    if (!owner || !repo) return null;
    return { owner, repo: repo.replace(/\.git$/, "") };
  }

  function readCache(key) {
    try {
      return JSON.parse(sessionStorage.getItem(CACHE_PREFIX + key));
    } catch {
      return null;
    }
  }

  function writeCache(key, value) {
    try {
      sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value));
    } catch {}
  }

  function compact(n) {
    return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
  }

  // Everything a preview shows, known without a network request.
  function baseData(link) {
    const url = new URL(link.href);
    const repo = githubRepo(url);
    const host = url.hostname.replace(/^www\./, "");
    const data = {
      url: url.href,
      host,
      title: link.textContent.trim() || host,
      description: link.title || "",
      image: "",
      meta: [],
      icon: `https://icons.duckduckgo.com/ip3/${host}.ico`,
    };
    if (repo) {
      data.title = `${repo.owner}/${repo.repo}`;
      data.image = `https://opengraph.githubassets.com/1/${repo.owner}/${repo.repo}`;
      data.icon = "";
      data.github = true;
    }
    return data;
  }

  // Adds what only the network knows. Resolves to the same object, filled in.
  function enrich(data) {
    const repo = githubRepo(new URL(data.url));
    if (!repo) return Promise.resolve(data);
    const key = `${repo.owner}/${repo.repo}`.toLowerCase();
    const cached = readCache(key);
    const request =
      cached
        ? Promise.resolve(cached)
        : pending.get(key) ||
          fetch(`https://api.github.com/repos/${repo.owner}/${repo.repo}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((json) => {
              const info = json && {
                name: json.full_name,
                description: json.description || "",
                stars: json.stargazers_count,
                language: json.language,
              };
              if (info) writeCache(key, info);
              return info;
            })
            .catch(() => null);
    pending.set(key, request);
    return request.then((info) => {
      if (!info) return data;
      data.title = info.name || data.title;
      data.description = data.description || info.description;
      data.meta = [
        info.language,
        info.stars > 0 ? `★ ${compact(info.stars)}` : null,
      ].filter(Boolean);
      return data;
    });
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  const GITHUB_ICON =
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>';

  // The source line: favicon (or GitHub mark), host, then any meta.
  function sourceLine(data) {
    const line = el("span", "lp-source");
    if (data.github) {
      const icon = el("span", "lp-icon");
      icon.innerHTML = GITHUB_ICON;
      line.append(icon);
    } else if (data.icon) {
      const icon = el("img", "lp-icon");
      icon.src = data.icon;
      icon.alt = "";
      icon.width = icon.height = 14;
      icon.onerror = () => icon.remove();
      line.append(icon);
    }
    line.append(el("span", null, data.host));
    data.meta.forEach((item) => line.append(el("span", "lp-dot", "·"), el("span", null, item)));
    return line;
  }

  function fill(target, data, { withImage }) {
    const text = el("span", "lp-text");
    text.append(sourceLine(data), el("span", "lp-title", data.title));
    if (data.description) text.append(el("span", "lp-desc", data.description));
    const parts = [text];
    if (withImage && data.image) {
      const frame = el("span", "lp-image");
      const img = el("img");
      img.src = data.image;
      img.alt = "";
      img.loading = "lazy";
      img.onerror = () => frame.remove();
      frame.append(img);
      parts.push(frame);
    }
    target.replaceChildren(...parts);
  }

  function isOutbound(link) {
    try {
      const url = new URL(link.href);
      return /^https?:$/.test(url.protocol) && url.origin !== location.origin;
    } catch {
      return false;
    }
  }

  // --- Cards ---------------------------------------------------------------

  function buildCard(link) {
    const card = el("a", "link-card");
    card.href = link.href;
    card.target = "_blank";
    card.rel = "noopener";
    const data = baseData(link);
    fill(card, data, { withImage: true });
    enrich(data).then((filled) => fill(card, filled, { withImage: true }));
    return card;
  }

  function buildCards(root) {
    root.querySelectorAll("p").forEach((p) => {
      const link = p.querySelector(":scope > a");
      if (!link || p.childElementCount !== 1 || p.textContent.trim() !== link.textContent.trim()) {
        return;
      }
      if (!isOutbound(link)) return;
      p.replaceWith(buildCard(link));
    });
  }

  // --- Hover previews ------------------------------------------------------

  let popover;
  let showTimer;
  let hideTimer;
  let current;

  function getPopover() {
    if (popover) return popover;
    popover = el("div", "link-popover");
    popover.setAttribute("role", "tooltip");
    popover.id = "link-popover";
    popover.addEventListener("pointerenter", () => clearTimeout(hideTimer));
    popover.addEventListener("pointerleave", scheduleHide);
    document.body.append(popover);
    return popover;
  }

  function place(link) {
    const box = getPopover();
    const rect = link.getBoundingClientRect();
    const width = box.offsetWidth;
    const gap = 10;
    const left = Math.min(
      Math.max(12, rect.left + rect.width / 2 - width / 2),
      window.innerWidth - width - 12,
    );
    const below = rect.bottom + gap + box.offsetHeight < window.innerHeight;
    box.style.left = `${left + window.scrollX}px`;
    box.style.top = below
      ? `${rect.bottom + gap + window.scrollY}px`
      : `${rect.top - gap - box.offsetHeight + window.scrollY}px`;
    box.dataset.side = below ? "below" : "above";
  }

  function show(link) {
    clearTimeout(hideTimer);
    if (current === link) return;
    current = link;
    const box = getPopover();
    const data = baseData(link);
    fill(box, data, { withImage: true });
    box.classList.remove("is-open");
    place(link);
    requestAnimationFrame(() => box.classList.add("is-open"));
    link.setAttribute("aria-describedby", box.id);
    enrich(data).then((filled) => {
      if (current !== link) return;
      fill(box, filled, { withImage: true });
      place(link);
    });
    // The image arrives later and changes the height.
    box.querySelector(".lp-image img")?.addEventListener("load", () => current === link && place(link));
  }

  function hide() {
    if (!current) return;
    current.removeAttribute("aria-describedby");
    current = null;
    popover?.classList.remove("is-open");
  }

  function scheduleHide() {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, 120);
  }

  function attachHover(root) {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    root.querySelectorAll("a[href]").forEach((link) => {
      if (link.classList.contains("link-card") || !isOutbound(link)) return;
      link.classList.add("has-preview");
      link.addEventListener("pointerenter", () => {
        clearTimeout(showTimer);
        showTimer = setTimeout(() => show(link), 280);
      });
      link.addEventListener("pointerleave", scheduleHide);
      link.addEventListener("focus", () => show(link));
      link.addEventListener("blur", scheduleHide);
    });
    window.addEventListener("scroll", () => current && place(current), { passive: true });
    document.addEventListener("keydown", (event) => event.key === "Escape" && hide());
  }

  window.enhanceLinks = (root) => {
    buildCards(root);
    attachHover(root);
  };
})();
