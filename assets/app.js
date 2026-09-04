const views = {
  loading: document.querySelector("#loading-view"),
  app: document.querySelector("#app-view"),
};

const state = {
  jobs: [],
  issueNumber: issueNumberFromPath(),
};

function assetUrl(path) {
  const script = document.querySelector('script[src$="/app.js"]');
  const scriptUrl = script?.src || new URL("assets/app.js", document.baseURI).toString();
  return new URL(path, new URL("../", scriptUrl)).toString();
}

function issueNumberFromPath() {
  const segments = window.location.pathname.split("/").filter(Boolean);
  const candidate = segments.at(-1);
  return /^\d+$/.test(candidate || "") ? Number(candidate) : null;
}

function issueRouteUrl(issueNumber) {
  return assetUrl(`${encodeURIComponent(issueNumber)}/`);
}

function showView(name) {
  Object.entries(views).forEach(([key, element]) => element.classList.toggle("hidden", key !== name));
}

function timeAgo(value) {
  if (!value) return "Not started";
  const timestamp = new Date(value).getTime();
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function toast(message) {
  const element = document.querySelector("#toast");
  element.textContent = message;
  element.classList.add("visible");
  window.setTimeout(() => element.classList.remove("visible"), 3200);
}

async function api(path, options = {}) {
  const headers = { Accept: "application/json", ...(options.headers || {}) };
  const response = await fetch(path, { credentials: "same-origin", ...options, headers });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    throw new Error(payload?.error || "The server could not complete this request.");
  }
  return payload;
}

function buildJobCard(job) {
  const card = document.createElement("article");
  card.className = "job-card";

  const main = document.createElement("div");
  main.className = "job-main";
  const number = document.createElement("span");
  number.className = "job-number";
  number.textContent = `#${job.issue_number ?? "—"}`;
  const identity = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = `Issue #${job.issue_number ?? "—"}`;
  const mode = document.createElement("small");
  mode.textContent = job.scope === "comment-cutover" ? "Comment-scoped update" : "Full issue review";
  identity.append(title, mode);
  main.append(number, identity);

  const metadata = document.createElement("div");
  metadata.className = "job-progress";
  const reviewType = document.createElement("strong");
  reviewType.textContent = job.mode ? `${job.mode} security review` : "Security review";
  const source = document.createElement("small");
  source.textContent = "yearn/yearn-strategies";
  metadata.append(reviewType, source);

  const published = document.createElement("div");
  published.className = "job-state";
  const publishedCopy = document.createElement("span");
  publishedCopy.textContent = `Published ${timeAgo(job.published_at || job.finished_at)}`;
  published.append(publishedCopy);

  const actions = document.createElement("div");
  actions.className = "job-actions";
  const report = document.createElement("button");
  report.type = "button";
  report.className = "button button-primary";
  report.textContent = "Read report";
  report.addEventListener("click", () => openReport(job));
  const share = document.createElement("a");
  share.className = "button button-quiet";
  share.href = issueRouteUrl(job.issue_number);
  share.textContent = "Share issue";
  share.title = `Permanent link for issue #${job.issue_number}`;
  actions.append(report, share);

  card.append(main, metadata, published, actions);
  return card;
}

function renderJobs() {
  const list = document.querySelector("#jobs-list");
  const empty = document.querySelector("#jobs-empty");
  list.replaceChildren();
  empty.classList.toggle("hidden", state.jobs.length !== 0);
  document.querySelector("#report-count").textContent = `${state.jobs.length} published ${state.jobs.length === 1 ? "report" : "reports"}`;
  if (state.issueNumber !== null) {
    document.querySelector("#jobs-title").textContent = `Published reviews for issue #${state.issueNumber}`;
  }
  state.jobs.forEach((job) => list.append(buildJobCard(job)));
}

async function loadJobs({ quiet = false } = {}) {
  try {
    const payload = await api(assetUrl("reports.json"), { cache: "no-store" });
    const jobs = payload.jobs || [];
    state.jobs = state.issueNumber === null
      ? jobs
      : jobs.filter((job) => Number(job.issue_number) === state.issueNumber);
    renderJobs();
  } catch (error) {
    if (!quiet) toast(error.message);
  }
}

function appendInline(parent, text) {
  const pattern = /(\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|`([^`]+)`|\*\*([^*]+)\*\*)/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > cursor) parent.append(document.createTextNode(text.slice(cursor, match.index)));
    if (match[2] && match[3]) {
      const link = document.createElement("a");
      link.href = match[3];
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = match[2];
      parent.append(link);
    } else if (match[4]) {
      const code = document.createElement("code");
      code.textContent = match[4];
      parent.append(code);
    } else if (match[5]) {
      const strong = document.createElement("strong");
      strong.textContent = match[5];
      parent.append(strong);
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) parent.append(document.createTextNode(text.slice(cursor)));
}

function startsMarkdownBlock(line) {
  return /^(#{1,6})\s+/.test(line)
    || /^```/.test(line)
    || /^>\s?/.test(line)
    || /^\s*[-*+]\s+/.test(line)
    || /^\s*\d+\.\s+/.test(line)
    || /^\s*(---+|___+|\*\*\*+)\s*$/.test(line);
}

function renderMarkdown(container, markdown) {
  container.replaceChildren();
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (/^```/.test(line)) {
      const language = line.slice(3).trim();
      const codeLines = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      if (language) code.dataset.language = language;
      code.textContent = codeLines.join("\n");
      pre.append(code);
      container.append(pre);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const element = document.createElement(`h${heading[1].length}`);
      appendInline(element, heading[2]);
      container.append(element);
      index += 1;
      continue;
    }

    if (/^\s*(---+|___+|\*\*\*+)\s*$/.test(line)) {
      container.append(document.createElement("hr"));
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      const blockquote = document.createElement("blockquote");
      appendInline(blockquote, quote.join(" "));
      container.append(blockquote);
      continue;
    }

    const unordered = /^\s*[-*+]\s+/.test(line);
    const ordered = /^\s*\d+\.\s+/.test(line);
    if (unordered || ordered) {
      const list = document.createElement(ordered ? "ol" : "ul");
      const itemPattern = ordered ? /^\s*\d+\.\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/;
      while (index < lines.length) {
        const item = lines[index].match(itemPattern);
        if (!item) break;
        const listItem = document.createElement("li");
        appendInline(listItem, item[1]);
        list.append(listItem);
        index += 1;
      }
      container.append(list);
      continue;
    }

    const paragraphLines = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() && !startsMarkdownBlock(lines[index])) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    const paragraph = document.createElement("p");
    appendInline(paragraph, paragraphLines.join(" "));
    container.append(paragraph);
  }
}

async function openReport(job) {
  const dialog = document.querySelector("#report-dialog");
  const content = document.querySelector("#report-content");
  content.textContent = "A tapir is unrolling the report…";
  document.querySelector("#report-title").textContent = `Issue #${job.issue_number} security report`;
  const reportUrl = assetUrl(`reports/${encodeURIComponent(job.id)}.md`);
  document.querySelector("#report-download").href = reportUrl;
  dialog.showModal();
  try {
    const response = await fetch(reportUrl, {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) throw new Error("The report could not be loaded.");
    renderMarkdown(content, await response.text());
  } catch (error) {
    content.textContent = error.message;
  }
}

async function bootstrap() {
  showView("app");
  try {
    await loadJobs();
    if (state.issueNumber !== null && state.jobs.length > 0) {
      await openReport(state.jobs[0]);
    }
    window.setInterval(() => loadJobs({ quiet: true }), 60_000);
  } catch (error) {
    toast(error.message);
  }
}

document.querySelector("#report-close").addEventListener("click", () => {
  document.querySelector("#report-dialog").close();
});

document.querySelector("#report-dialog").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) event.currentTarget.close();
});

bootstrap();
