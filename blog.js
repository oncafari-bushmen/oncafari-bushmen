// Blog: posts are Markdown files in blog/, listed in blog/posts.json.
// Each file starts with a frontmatter block (title, date, summary).
// A static host can't list a directory, which is why the manifest exists.

const BLOG_DIR = "blog/";

function parseFrontmatter(source) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { meta: {}, body: source };
  const meta = {};
  match[1].split(/\r?\n/).forEach((line) => {
    const index = line.indexOf(":");
    if (index === -1) return;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (key) meta[key] = value;
  });
  return { meta, body: source.slice(match[0].length) };
}

async function loadPost(slug) {
  const response = await fetch(`${BLOG_DIR}${encodeURIComponent(slug)}.md`);
  if (!response.ok) throw new Error(`Post not found: ${slug}`);
  const { meta, body } = parseFrontmatter(await response.text());
  return {
    slug,
    title: meta.title || slug,
    date: meta.date || "",
    summary: meta.summary || "",
    script: meta.script || "",
    style: meta.style || "",
    body,
  };
}

async function loadPosts() {
  const response = await fetch(`${BLOG_DIR}posts.json`);
  const slugs = await response.json();
  const posts = await Promise.all(slugs.map((slug) => loadPost(slug).catch(() => null)));
  return posts.filter(Boolean).sort((a, b) => b.date.localeCompare(a.date));
}

function formatDate(date) {
  if (!date) return "";
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

// Homepage: fill the list of posts.
async function renderBlogList(list) {
  try {
    const posts = await loadPosts();
    list.replaceChildren(
      ...posts.map((post) => {
        const item = document.createElement("li");
        const link = el("a", "blog-card");
        link.href = `post.html?slug=${encodeURIComponent(post.slug)}`;
        const heading = el("h3", null, post.title);
        if (post.date) {
          const time = el("time", null, formatDate(post.date));
          time.dateTime = post.date;
          heading.append(time);
        }
        link.append(heading);
        if (post.summary) link.append(el("p", null, post.summary));
        item.append(link);
        return item;
      }),
    );
    if (!posts.length) list.closest("section").hidden = true;
  } catch {
    list.closest("section").hidden = true;
  }
}

// Post page: render one Markdown file.
async function renderPostPage(container) {
  const slug = new URLSearchParams(location.search).get("slug") || "oncafari";
  const title = container.querySelector(".post-title");
  const time = container.querySelector(".post-date");
  const body = container.querySelector(".post-body");
  try {
    if (!slug) throw new Error("No post given");
    const post = await loadPost(slug);
    document.title = `${post.title} — João Laufer Barbosa`;
    title.textContent = post.title;
    time.textContent = formatDate(post.date);
    time.dateTime = post.date;
    body.innerHTML = window.marked ? window.marked.parse(post.body) : "";
    if (!window.marked) body.textContent = post.body;
    styleTeam(body);
    window.enhanceLinks?.(body);
    buildToc(container, body);
    loadPostExtras(post);
  } catch {
    title.textContent = "Post not found";
    body.replaceChildren(el("p", null, "That post doesn’t exist (yet)."));
  }
}

// A "## Team" section in a post becomes team cards. Each **bold line** names a
// group and the list under it holds its people, written "Name — Role".
function styleTeam(body) {
  const heading = [...body.querySelectorAll("h2")].find((h) => h.textContent.trim().toLowerCase() === "team");
  if (!heading) return;
  const team = el("div", "post-team");
  let group = null;
  let node = heading.nextElementSibling;
  while (node && node.tagName !== "H2") {
    const next = node.nextElementSibling;
    const label = node.tagName === "P" && node.children.length === 1 && node.firstElementChild.tagName === "STRONG";
    if (label || !group) {
      group = el("div", "post-team-group");
      if (label) group.append(el("p", "post-team-name", node.textContent.trim()));
      team.append(group);
    }
    if (node.tagName === "UL") {
      const people = el("ul", "post-team-people");
      [...node.children].forEach((li) => {
        const [name, ...role] = li.textContent.split(/\s+[—–-]\s+/);
        const person = el("li");
        person.append(el("span", "post-team-person", name.trim()));
        if (role.length) person.append(el("span", "post-team-role", role.join(" — ").trim()));
        people.append(person);
      });
      group.append(people);
    } else if (!label) {
      group.append(node);
    }
    if (label || node.tagName === "UL") node.remove();
    node = next;
  }
  heading.after(team);
}

// A post can bring its own interactive figures: `style:` and `script:` in its
// frontmatter name files inside blog/, loaded after the Markdown renders.
function loadPostExtras(post) {
  const local = (path) => /^[\w./-]+$/.test(path) && !path.includes("..");
  if (post.style && local(post.style)) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = BLOG_DIR + post.style;
    document.head.append(link);
  }
  if (post.script && local(post.script)) {
    const script = document.createElement("script");
    script.src = BLOG_DIR + post.script;
    document.body.append(script);
  }
}

function slugify(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// Sidebar: one link per h2/h3 in the post, highlighting the section in view.
function buildToc(container, body) {
  const list = container.querySelector(".post-toc-list");
  const headings = [...body.querySelectorAll("h2, h3")];
  if (headings.length < 2) return;

  const used = new Set();
  const links = headings.map((heading) => {
    let id = slugify(heading.textContent) || "section";
    for (let n = 2; used.has(id); n++) id = `${slugify(heading.textContent)}-${n}`;
    used.add(id);
    heading.id = id;
    const item = el("li", heading.tagName === "H3" ? "is-sub" : null);
    const link = el("a", null, heading.textContent);
    link.href = `#${id}`;
    item.append(link);
    list.append(item);
    return link;
  });
  const details = container.querySelector(".post-toc-details");
  details.hidden = false;
  container.classList.add("has-toc");

  // Open as a sidebar on wide screens, collapsed above the post on narrow ones.
  const wide = window.matchMedia("(min-width: 1000px)");
  const syncOpen = () => (details.open = wide.matches);
  syncOpen();
  wide.addEventListener("change", syncOpen);
  list.addEventListener("click", (event) => {
    if (event.target.closest("a") && !wide.matches) details.open = false;
  });

  // The current section is the last heading that has scrolled past the top band.
  // A post's script can move a heading out of the article (into a sticky
  // sidebar, say); those no longer mark a place in the text, so skip them.
  const setActive = () => {
    let index = 0;
    headings.forEach((heading, i) => {
      if (body.contains(heading) && heading.getBoundingClientRect().top < 140) index = i;
    });
    if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 4) {
      index = headings.findLastIndex((heading) => body.contains(heading));
    }
    links.forEach((link, i) => link.classList.toggle("is-active", i === index));
  };
  setActive();
  window.addEventListener("scroll", setActive, { passive: true });

  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
}

const blogList = document.querySelector("#blog-list");
if (blogList) renderBlogList(blogList);
const postPage = document.querySelector(".post-page");
if (postPage) renderPostPage(postPage);
