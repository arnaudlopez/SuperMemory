const textExtensions = new Set(["md", "markdown", "txt"]);
const binaryExtensions = new Set(["pdf", "docx"]);
const supportedExtensions = new Set([...textExtensions, ...binaryExtensions]);

const elements = {
  projectSelector: document.querySelector("#project-selector"),
  sourceCount: document.querySelector("#source-count"),
  candidateCount: document.querySelector("#candidate-count"),
  candidateCountLabel: document.querySelector("#candidate-count-label"),
  memoryCount: document.querySelector("#memory-count"),
  memoryCountLabel: document.querySelector("#memory-count-label"),
  staleCount: document.querySelector("#stale-count"),
  reviewBadge: document.querySelector("#review-badge"),
  reviewTabLabel: document.querySelector("#review-tab-label"),
  reviewTitle: document.querySelector("#review-title"),
  reviewDescription: document.querySelector("#review-description"),
  removalBadge: document.querySelector("#removal-badge"),
  folderInput: document.querySelector("#folder-input"),
  selectionCard: document.querySelector("#selection-card"),
  selectionTitle: document.querySelector("#selection-title"),
  selectionDetails: document.querySelector("#selection-details"),
  ingestButton: document.querySelector("#ingest-button"),
  candidateList: document.querySelector("#candidate-list"),
  refreshCandidates: document.querySelector("#refresh-candidates"),
  searchForm: document.querySelector("#search-form"),
  searchInput: document.querySelector("#search-input"),
  searchResults: document.querySelector("#search-results"),
  sourceList: document.querySelector("#source-list"),
  refreshSources: document.querySelector("#refresh-sources"),
  backupList: document.querySelector("#backup-list"),
  createBackup: document.querySelector("#create-backup"),
  hindsightDot: document.querySelector("#hindsight-dot"),
  hindsightStatus: document.querySelector("#hindsight-status"),
  hindsightDetails: document.querySelector("#hindsight-details"),
  derivedMemoryPlanes: [...document.querySelectorAll(".memory-plane.derived")],
  retryProjections: document.querySelector("#retry-projections"),
  engineLabel: document.querySelector("#engine-label"),
  workingBindingForm: document.querySelector("#working-binding-form"),
  workingSetInput: document.querySelector("#working-set-input"),
  topicDashboard: document.querySelector("#topic-dashboard"),
  refreshWork: document.querySelector("#refresh-work"),
  authorityExceptionList: document.querySelector("#authority-exception-list"),
  refreshAuthorityExceptions: document.querySelector("#refresh-authority-exceptions"),
  authorityExceptionBadge: document.querySelector("#authority-exception-badge"),
  toast: document.querySelector("#toast")
};

let selectedFiles = [];
let toastTimer;
let automaticAdmission = false;

function boundProject() {
  return elements.projectSelector.value || new URLSearchParams(window.location.search).get("projectId") ||
    localStorage.getItem("supermemory.project_id") || "";
}

async function loadProjects() {
  const payload = await api("/api/projects");
  const requested = boundProject();
  elements.projectSelector.replaceChildren();
  for (const project of payload.projects ?? []) {
    const option = document.createElement("option");
    option.value = project.projectId;
    option.textContent = project.displayName;
    elements.projectSelector.append(option);
  }
  if (requested && (payload.projects ?? []).some((item) => item.projectId === requested)) {
    elements.projectSelector.value = requested;
  }
  if (!elements.projectSelector.value && elements.projectSelector.options.length > 0) {
    elements.projectSelector.selectedIndex = 0;
  }
  if (elements.projectSelector.value) localStorage.setItem("supermemory.project_id", elements.projectSelector.value);
}

function extension(filename) {
  const index = filename.lastIndexOf(".");
  return index === -1 ? "" : filename.slice(index + 1).toLowerCase();
}

function folderName(files) {
  const relative = files[0]?.webkitRelativePath;
  return relative?.split("/")[0] || "Dossier local";
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers ?? {})
    }
  });
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.error?.message || "Une erreur locale est survenue.");
    error.code = payload.error?.code;
    throw error;
  }
  return payload;
}

function showToast(message, kind = "success") {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle("error", kind === "error");
  elements.toast.classList.toggle("warning", kind === "warning");
  elements.toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, 5_000);
}

function showTab(name) {
  for (const button of document.querySelectorAll("[data-tab]")) {
    button.classList.toggle("active", button.dataset.tab === name);
  }
  for (const panel of document.querySelectorAll("[data-panel]")) {
    const active = panel.dataset.panel === name;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
  }
  if (name === "review") loadCandidates();
  if (name === "search") elements.searchInput.focus();
  if (name === "manage") Promise.all([loadSources(), loadBackups()]);
  if (name === "work") loadWork();
  if (name === "exceptions") loadAuthorityExceptions();
}

function emptyState(title, message) {
  const container = document.createElement("div");
  container.className = "empty-state";
  const strong = document.createElement("strong");
  strong.textContent = title;
  const span = document.createElement("span");
  span.textContent = message;
  container.append(strong, span);
  return container;
}

async function loadStatus() {
  const status = await api("/api/status");
  automaticAdmission = status.admission?.mode === "automatic";
  const reviewCount = automaticAdmission ? status.counts.exceptions : status.counts.pendingCandidates;
  elements.sourceCount.textContent = status.counts.sources;
  elements.candidateCount.textContent = reviewCount;
  elements.memoryCount.textContent = status.counts.approvedMemories;
  elements.staleCount.textContent = status.counts.staleMemories;
  elements.reviewBadge.textContent = reviewCount;
  elements.reviewBadge.hidden = reviewCount === 0;
  elements.candidateCountLabel.textContent = automaticAdmission ? "Exceptions" : "À valider";
  elements.memoryCountLabel.textContent = automaticAdmission ? "Mémoires admises" : "Mémoires approuvées";
  elements.reviewTabLabel.textContent = automaticAdmission ? "Exceptions" : "Valider";
  elements.reviewTitle.textContent = automaticAdmission ? "Exceptions persistantes" : "Gardez uniquement ce qui compte";
  elements.reviewDescription.textContent = automaticAdmission
    ? "Les admissions standard sont automatiques. Seuls les conflits ou risques persistants apparaissent ici."
    : "Chaque proposition reste inactive jusqu’à votre décision.";
  elements.removalBadge.textContent = status.counts.pendingRemovals;
  elements.removalBadge.hidden = status.counts.pendingRemovals === 0;
  const pending = status.counts.pendingProjections;
  const pendingDeletions = status.counts.pendingHindsightDeletions;
  const ready = status.hindsight.status === "ready";
  for (const plane of elements.derivedMemoryPlanes) {
    plane.dataset.state = ready ? "ready" : "degraded";
  }
  elements.hindsightDot.classList.toggle("unavailable", !ready);
  elements.hindsightStatus.textContent = ready
    ? pending
      ? "Hindsight répond — projection à reprendre"
      : "Hindsight local est prêt"
    : status.hindsight.status === "disabled"
      ? "Hindsight est désactivé"
      : "Hindsight est indisponible — repli local actif";
  elements.hindsightDetails.textContent = pending || pendingDeletions
    ? [
        pending ? `${pending} projection(s) attendent une resynchronisation.` : null,
        pendingDeletions ? `${pendingDeletions} suppression(s) Hindsight sont en attente.` : null
      ].filter(Boolean).join(" ")
    : ready
      ? "Toutes les mémoires approuvées sont projetées ou prêtes à l’être."
      : "Le vault reste utilisable et la recherche locale prend le relais.";
  elements.retryProjections.hidden = pending === 0 && pendingDeletions === 0;
  elements.engineLabel.textContent = ready
    ? "Hindsight local gouverné"
    : "Repli local déterministe";
}

function sourceUrl(candidate) {
  const params = new URLSearchParams({
    snapshot: candidate.snapshotId
  });
  if (candidate.locator) params.set("locator", JSON.stringify(candidate.locator));
  if (candidate.lineStart) params.set("lineStart", String(candidate.lineStart));
  if (candidate.lineEnd) params.set("lineEnd", String(candidate.lineEnd));
  return `/source/${encodeURIComponent(candidate.sourceId)}?${params}`;
}

function citationLabel(candidate) {
  const locator = candidate.locator;
  if (locator?.kind === "pdf_page") return `${candidate.relativePath} · page ${locator.page}`;
  if (locator?.kind === "docx_section") {
    return `${candidate.relativePath} · section ${locator.section} — ${locator.heading}`;
  }
  return `${candidate.relativePath} · lignes ${candidate.lineStart}-${candidate.lineEnd}`;
}

function candidateCard(candidate) {
  const article = document.createElement("article");
  article.className = "candidate";
  article.dataset.candidateId = candidate.candidateId;

  const header = document.createElement("header");
  const titleGroup = document.createElement("div");
  const kicker = document.createElement("span");
  kicker.className = "candidate-kicker";
  kicker.textContent = candidate.sensitivity === "restricted_review"
    ? "Contenu sensible à vérifier"
    : automaticAdmission ? "Exception d’admission" : "Mémoire candidate";
  const title = document.createElement("input");
  title.value = candidate.title;
  title.setAttribute("aria-label", "Titre de la mémoire");
  titleGroup.append(kicker, title);
  const cite = document.createElement("cite");
  cite.textContent = citationLabel(candidate);
  header.append(titleGroup, cite);

  const textarea = document.createElement("textarea");
  textarea.value = candidate.text;
  textarea.readOnly = automaticAdmission;
  textarea.setAttribute("aria-label", "Contenu de la mémoire");

  const footer = document.createElement("footer");
  const source = document.createElement("a");
  source.className = "citation-link";
  source.href = sourceUrl(candidate);
  source.target = "_blank";
  source.rel = "noopener";
  source.textContent = "Ouvrir la source ↗";

  const actions = document.createElement("div");
  actions.className = "candidate-actions";
  const reject = document.createElement("button");
  reject.type = "button";
  reject.className = "button danger";
  reject.textContent = "Refuser";
  const approve = document.createElement("button");
  approve.type = "button";
  approve.className = "button primary";
  approve.textContent = "Approuver";
  if (automaticAdmission) {
    const reason = document.createElement("small");
    reason.textContent = "Non rappelable · réévaluation automatique après nouveaux signaux vérifiés.";
    actions.append(reason);
    title.readOnly = true;
  } else {
    actions.append(reject, approve);
  }
  footer.append(source, actions);
  article.append(header, textarea, footer);

  const review = async (action) => {
    reject.disabled = true;
    approve.disabled = true;
    try {
      const result = await api(`/api/candidates/${encodeURIComponent(candidate.candidateId)}/review`, {
        method: "POST",
        body: JSON.stringify({ action, title: title.value, text: textarea.value })
      });
      article.remove();
      const projectionQueued = action === "approve" && result.memory?.projection?.status !== "synced";
      showToast(
        action === "reject"
          ? "Candidate refusée."
          : projectionQueued
            ? "Mémoire approuvée dans le vault. Projection Hindsight en attente."
            : "Mémoire approuvée, enregistrée et projetée dans Hindsight.",
        projectionQueued ? "warning" : "success"
      );
      if (!elements.candidateList.children.length) {
        elements.candidateList.append(emptyState(
          "Tout est à jour",
          "Aucune mémoire n’attend votre validation."
        ));
      }
      await loadStatus();
    } catch (error) {
      reject.disabled = false;
      approve.disabled = false;
      showToast(error.message, "error");
    }
  };

  if (!automaticAdmission) {
    reject.addEventListener("click", () => review("reject"));
    approve.addEventListener("click", () => review("approve"));
  }
  return article;
}

async function loadCandidates() {
  elements.candidateList.replaceChildren(emptyState("Chargement…", "Lecture de la file locale."));
  try {
    const status = automaticAdmission ? "quarantined" : "pending";
    const { candidates } = await api(`/api/candidates?status=${status}`);
    elements.candidateList.replaceChildren();
    if (candidates.length === 0) {
      elements.candidateList.append(emptyState(
        automaticAdmission ? "Aucune exception persistante" : "Aucune candidate en attente",
        automaticAdmission
          ? "Les admissions standard n’attendent aucun clic humain."
          : "Importez un dossier ou revenez après avoir modifié une source."
      ));
      return;
    }
    for (const candidate of candidates) {
      elements.candidateList.append(candidateCard(candidate));
    }
  } catch (error) {
    elements.candidateList.replaceChildren(emptyState("Impossible de charger la file", error.message));
  }
}

function sourceCard(source) {
  const article = document.createElement("article");
  article.className = `source-card ${source.status}`;
  const copy = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = source.relativePath;
  const meta = document.createElement("small");
  meta.textContent = source.status === "pending_removal"
    ? source.removalReason === "missing_from_inventory"
      ? "Absent du dernier inventaire · retiré de la recherche"
      : "Suppression demandée · retiré de la recherche"
    : `${source.sourceKind.toUpperCase()} · ${source.memoryCount} mémoire(s)`;
  copy.append(title, meta);

  const actions = document.createElement("div");
  if (source.status === "pending_removal") {
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "button ghost";
    cancel.textContent = "Conserver";
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "button danger";
    confirm.textContent = "Supprimer définitivement";
    cancel.addEventListener("click", () => sourceRemoval(source, "cancel"));
    confirm.addEventListener("click", async () => {
      const accepted = window.confirm(
        `Supprimer définitivement ${source.relativePath} du vault et de Hindsight ?`
      );
      if (accepted) await sourceRemoval(source, "confirm");
    });
    actions.append(cancel, confirm);
  } else {
    const stage = document.createElement("button");
    stage.type = "button";
    stage.className = "button danger";
    stage.textContent = "Retirer…";
    stage.addEventListener("click", () => sourceRemoval(source, "stage"));
    actions.append(stage);
  }
  article.append(copy, actions);
  return article;
}

async function sourceRemoval(source, action) {
  try {
    const result = await api(`/api/sources/${encodeURIComponent(source.sourceId)}/removal`, {
      method: "POST",
      body: JSON.stringify({
        action,
        ...(action === "confirm" ? { confirmation: source.relativePath } : {})
      })
    });
    showToast(
      action === "confirm"
        ? result.hindsight.pending
          ? "Source purgée du vault. Suppression Hindsight en attente de retry."
          : "Source supprimée du vault et de Hindsight."
        : action === "cancel"
          ? "Suppression annulée ; la source est de nouveau active."
          : "Source retirée de la recherche. Confirmez la purge pour la supprimer.",
      action === "confirm" && result.hindsight.pending ? "warning" : "success"
    );
    await Promise.all([loadSources(), loadStatus()]);
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function loadSources() {
  elements.sourceList.replaceChildren(emptyState("Chargement…", "Lecture des sources locales."));
  try {
    const { sources } = await api("/api/sources");
    elements.sourceList.replaceChildren();
    if (!sources.length) {
      elements.sourceList.append(emptyState(
        "Aucune source active",
        "Importez un dossier pour commencer."
      ));
      return;
    }
    for (const source of sources) elements.sourceList.append(sourceCard(source));
  } catch (error) {
    elements.sourceList.replaceChildren(emptyState("Impossible de charger les sources", error.message));
  }
}

function backupCard(backup) {
  const article = document.createElement("article");
  article.className = `backup-card ${backup.verified ? "verified" : "invalid"}`;
  const copy = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = backup.verified
    ? new Date(backup.createdAt).toLocaleString("fr-FR")
    : "Sauvegarde non vérifiable";
  const meta = document.createElement("small");
  meta.textContent = backup.verified
    ? `${backup.files} fichier(s) · ${new Intl.NumberFormat("fr-FR").format(backup.bytes)} octets · ${backup.reason}`
    : `Intégrité refusée (${backup.errorCode})`;
  const id = document.createElement("code");
  id.textContent = backup.backupId;
  copy.append(title, meta, id);
  article.append(copy);

  if (backup.verified) {
    const restore = document.createElement("button");
    restore.type = "button";
    restore.className = "button danger";
    restore.textContent = "Restaurer…";
    restore.addEventListener("click", async () => {
      const confirmation = `RESTORE ${backup.backupId}`;
      const accepted = window.confirm(
        `Restaurer ${backup.backupId} ?\n\nUne sauvegarde de sécurité sera créée avant le remplacement. Confirmation exacte : ${confirmation}`
      );
      if (!accepted) return;
      restore.disabled = true;
      try {
        const result = await api(`/api/backups/${encodeURIComponent(backup.backupId)}/restore`, {
          method: "POST",
          body: JSON.stringify({ confirmation })
        });
        showToast(
          result.hindsightRebuild?.status === "rebuilt"
            ? `Vault restauré et index Hindsight reconstruit. Sauvegarde de sécurité : ${result.safetyBackupId}.`
            : `Vault restauré. La reconstruction Hindsight reste en attente. Sauvegarde de sécurité : ${result.safetyBackupId}.`,
          result.hindsightRebuild?.status === "rebuilt" ? "success" : "warning"
        );
        window.setTimeout(() => window.location.reload(), 900);
      } catch (error) {
        restore.disabled = false;
        showToast(error.message, "error");
      }
    });
    article.append(restore);
  }
  return article;
}

async function loadBackups() {
  elements.backupList.replaceChildren(emptyState("Chargement…", "Vérification des sauvegardes locales."));
  try {
    const { backups } = await api("/api/backups");
    elements.backupList.replaceChildren();
    if (!backups.length) {
      elements.backupList.append(emptyState(
        "Aucune sauvegarde",
        "Créez une première sauvegarde avant une opération importante."
      ));
      return;
    }
    for (const backup of backups) elements.backupList.append(backupCard(backup));
  } catch (error) {
    elements.backupList.replaceChildren(emptyState("Sauvegardes indisponibles", error.message));
  }
}

async function createBackup() {
  elements.createBackup.disabled = true;
  elements.createBackup.textContent = "Sauvegarde…";
  try {
    const result = await api("/api/backups", {
      method: "POST",
      body: JSON.stringify({ reason: "manual-web" })
    });
    showToast(`Sauvegarde vérifiée créée : ${result.backup.backupId}`);
    await loadBackups();
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    elements.createBackup.disabled = false;
    elements.createBackup.textContent = "Créer une sauvegarde";
  }
}

function searchCard(result) {
  const article = document.createElement("article");
  article.className = "result-card";
  const title = document.createElement("h3");
  title.textContent = result.title;
  const text = document.createElement("p");
  text.textContent = result.text;
  const source = document.createElement("a");
  source.className = "citation-link";
  source.target = "_blank";
  source.rel = "noopener";
  source.href = sourceUrl({
    sourceId: result.citation.sourceId,
    snapshotId: result.citation.snapshotId,
    lineStart: result.citation.lineStart,
    lineEnd: result.citation.lineEnd,
    locator: result.citation.locator
  });
  source.textContent = `Source : ${result.citation.label} ↗`;
  article.append(title, text, source);
  return article;
}

async function performSearch(event) {
  event.preventDefault();
  const query = elements.searchInput.value.trim();
  if (!query) {
    showToast("Saisis une question ou quelques mots-clés.", "error");
    return;
  }
  elements.searchResults.replaceChildren(emptyState("Recherche…", "Interrogation des mémoires approuvées."));
  try {
    const payload = await api("/api/search", {
      method: "POST",
      body: JSON.stringify({ query })
    });
    elements.searchResults.replaceChildren();
    const engineNote = document.createElement("div");
    engineNote.className = `search-engine-note ${payload.hindsightUsed ? "hindsight" : "fallback"}`;
    engineNote.textContent = payload.hindsightUsed
      ? "Résultats rappelés par Hindsight puis vérifiés contre le vault canonique."
      : "Hindsight n’est pas disponible pour cette recherche : résultats déterministes du vault local.";
    elements.searchResults.append(engineNote);
    elements.engineLabel.textContent = payload.hindsightUsed
      ? "Hindsight local gouverné"
      : "Repli local déterministe";
    if (payload.results.length === 0) {
      elements.searchResults.append(emptyState(
        "Aucun résultat approuvé",
        "Essaie d’autres mots ou valide d’abord une mémoire candidate."
      ));
      return;
    }
    for (const result of payload.results) elements.searchResults.append(searchCard(result));
  } catch (error) {
    elements.searchResults.replaceChildren(emptyState("Recherche impossible", error.message));
  }
}

async function retryProjections() {
  elements.retryProjections.disabled = true;
  elements.retryProjections.textContent = "Synchronisation…";
  try {
    const result = await api("/api/hindsight/retry", {
      method: "POST",
      body: JSON.stringify({})
    });
    const allDone = result.remaining === 0 && result.deletionsRemaining === 0;
    showToast(
      allDone
        ? `${result.synced} projection(s) et ${result.deleted} suppression(s) synchronisées.`
        : `${result.remaining} projection(s) et ${result.deletionsRemaining} suppression(s) restent en attente.`,
      allDone ? "success" : "warning"
    );
    await loadStatus();
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    elements.retryProjections.disabled = false;
    elements.retryProjections.textContent = "Resynchroniser";
  }
}

function boundWorkingSet() {
  return elements.workingSetInput.value.trim();
}

function citedList(title, items = []) {
  const section = document.createElement("section");
  section.className = "topic-section";
  const heading = document.createElement("h3");
  heading.textContent = title;
  section.append(heading);
  if (!items.length) {
    const empty = document.createElement("small");
    empty.textContent = "Aucun élément actif.";
    section.append(empty);
    return section;
  }
  const list = document.createElement("ul");
  for (const item of items) {
    const row = document.createElement("li");
    const text = document.createElement("span");
    text.textContent = item.text;
    const citation = document.createElement("code");
    citation.textContent = (item.evidence_ids ?? []).join(", ");
    row.append(text, citation);
    list.append(row);
  }
  section.append(list);
  return section;
}

async function loadWork() {
  const workingSetId = boundWorkingSet();
  if (!workingSetId) {
    elements.topicDashboard.replaceChildren(emptyState("Working Set requis", "Collez l’identifiant wset_… de votre session courante."));
    return;
  }
  localStorage.setItem("supermemory.working_set_id", workingSetId);
  elements.topicDashboard.replaceChildren(emptyState("Chargement…", "Construction de la vue citée du sujet."));
  try {
    const context = await api(`/api/work?workingSetId=${encodeURIComponent(workingSetId)}&projectId=${encodeURIComponent(boundProject())}`);
    const summary = document.createElement("article");
    summary.className = "topic-summary";
    const title = document.createElement("h3");
    title.textContent = context.topic.title;
    const meta = document.createElement("p");
    meta.textContent = `${context.membership.resolution} · ${context.memberships.length} session(s) · ${context.working_view.budget.selected_tokens.toLocaleString("fr-FR")} / ${context.working_view.budget.capacity_tokens.toLocaleString("fr-FR")} tokens`;
    const topicId = document.createElement("code");
    topicId.textContent = context.topic.topic_id;
    summary.append(title, meta, topicId);
    const sections = context.working_map.sections;
    elements.topicDashboard.replaceChildren(
      summary,
      citedList("Objectif", sections.goal),
      citedList("Invariants", sections.constraints),
      citedList("État courant", sections.current_state),
      citedList("Décisions", sections.decisions),
      citedList("Prochaines actions", sections.next_actions),
      citedList("Questions ouvertes", sections.open_questions)
    );
    await loadAuthorityExceptions();
  } catch (error) {
    elements.topicDashboard.replaceChildren(emptyState("Vue indisponible", error.message));
  }
}

function authorityExceptionCard(item) {
  const article = document.createElement("article");
  article.className = `authority-exception ${item.level}`;
  const copy = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = item.level === "blocking" ? "Action bloquée" : "Exception visible";
  const reason = document.createElement("p");
  reason.textContent = item.reason_codes.join(" · ");
  const meta = document.createElement("small");
  meta.textContent = `${item.impact} · ${item.irreversibility} · évaluée ${item.evaluation_count} fois`;
  copy.append(title, reason, meta);
  const resolve = document.createElement("button");
  resolve.type = "button";
  resolve.className = "button ghost";
  resolve.textContent = "Résoudre…";
  resolve.addEventListener("click", async () => {
    const decision = window.prompt("Décision owner à enregistrer pour cette exception :");
    if (!decision?.trim()) return;
    try {
      await api("/api/authority-exceptions/resolve", {
        method: "POST",
        body: JSON.stringify({
          workingSetId: boundWorkingSet(),
          projectId: boundProject(),
          fingerprint: item.fingerprint,
          decision
        })
      });
      showToast("Exception résolue avec un reçu d’audit local.");
      await loadAuthorityExceptions();
    } catch (error) {
      showToast(error.message, "error");
    }
  });
  article.append(copy, resolve);
  return article;
}

async function loadAuthorityExceptions() {
  const workingSetId = boundWorkingSet();
  if (!workingSetId) {
    elements.authorityExceptionList.replaceChildren(emptyState("Sujet non sélectionné", "Renseignez d’abord le Working Set dans la vue Travail."));
    return;
  }
  elements.authorityExceptionList.replaceChildren(emptyState("Chargement…", "Réévaluation des exceptions du sujet."));
  try {
    const payload = await api(`/api/authority-exceptions?workingSetId=${encodeURIComponent(workingSetId)}&projectId=${encodeURIComponent(boundProject())}`);
    elements.authorityExceptionBadge.textContent = payload.results.length;
    elements.authorityExceptionBadge.hidden = payload.results.length === 0;
    elements.authorityExceptionList.replaceChildren();
    if (!payload.results.length) {
      elements.authorityExceptionList.append(emptyState("Aucune exception visible", "Les ambiguïtés latentes restent silencieuses tant qu’elles ne bloquent aucune action."));
      return;
    }
    for (const item of payload.results) elements.authorityExceptionList.append(authorityExceptionCard(item));
  } catch (error) {
    elements.authorityExceptionList.replaceChildren(emptyState("Exceptions indisponibles", error.message));
  }
}

async function ingestSelection() {
  if (selectedFiles.length === 0) return;
  elements.ingestButton.disabled = true;
  elements.ingestButton.textContent = "Analyse locale…";
  try {
    const files = [];
    for (const file of selectedFiles) {
      const fileExtension = extension(file.name);
      const item = {
        name: file.name,
        relativePath: file.webkitRelativePath || file.name,
        size: file.size,
        type: file.type
      };
      if (textExtensions.has(fileExtension)) item.text = await file.text();
      if (binaryExtensions.has(fileExtension)) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        const chunkSize = 32_768;
        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
          binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
        }
        item.base64 = btoa(binary);
      }
      files.push(item);
    }
    const result = await api("/api/ingest", {
      method: "POST",
      body: JSON.stringify({
        folderName: folderName(selectedFiles),
        files,
        inventoryComplete: true
      })
    });
    const { summary } = result;
    const unsupported = result.unsupported.length
      ? ` ${result.unsupported.length} format(s) non pris en charge ont été ignorés.`
      : "";
    const warnings = result.warnings.length
      ? ` ${result.warnings.length} fichier(s) contiennent un motif sensible et restent à valider.`
      : "";
    const missing = summary.missingSources
      ? ` ${summary.missingSources} source(s) absente(s) ont été suspendues et attendent votre décision.`
      : "";
    showToast(`${summary.createdCandidates} candidate(s) créée(s).${unsupported}${warnings}${missing}`);
    await loadStatus();
    await loadCandidates();
    showTab(summary.missingSources ? "manage" : "review");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    elements.ingestButton.disabled = false;
    elements.ingestButton.textContent = "Créer les mémoires candidates";
  }
}

function updateSelection() {
  selectedFiles = [...elements.folderInput.files];
  if (selectedFiles.length === 0) {
    elements.selectionCard.hidden = true;
    return;
  }
  const ready = selectedFiles.filter((file) => supportedExtensions.has(extension(file.name)));
  const binaries = selectedFiles.filter((file) => binaryExtensions.has(extension(file.name)));
  const ignored = selectedFiles.length - ready.length;
  elements.selectionTitle.textContent = folderName(selectedFiles);
  elements.selectionDetails.textContent = [
    `${ready.length} fichier(s) prêt(s)`,
    binaries.length ? `${binaries.length} document(s) binaire(s)` : null,
    ignored ? `${ignored} format(s) ignoré(s)` : null
  ].filter(Boolean).join(" · ");
  elements.selectionCard.hidden = false;
}

for (const button of document.querySelectorAll("[data-tab]")) {
  button.addEventListener("click", () => showTab(button.dataset.tab));
}
elements.folderInput.addEventListener("change", updateSelection);
elements.ingestButton.addEventListener("click", ingestSelection);
elements.refreshCandidates.addEventListener("click", loadCandidates);
elements.refreshSources.addEventListener("click", loadSources);
elements.createBackup.addEventListener("click", createBackup);
elements.searchForm.addEventListener("submit", performSearch);
elements.retryProjections.addEventListener("click", retryProjections);
elements.workingBindingForm.addEventListener("submit", (event) => {
  event.preventDefault();
  loadWork();
});
elements.refreshWork.addEventListener("click", loadWork);
elements.refreshAuthorityExceptions.addEventListener("click", loadAuthorityExceptions);
elements.projectSelector.addEventListener("change", () => {
  localStorage.setItem("supermemory.project_id", elements.projectSelector.value);
  const url = new URL(window.location.href);
  url.searchParams.set("projectId", elements.projectSelector.value);
  window.history.replaceState({}, "", url);
  if (boundWorkingSet()) Promise.allSettled([loadWork(), loadAuthorityExceptions()]);
});

elements.workingSetInput.value = new URLSearchParams(window.location.search).get("workingSetId") ||
  localStorage.getItem("supermemory.working_set_id") || "";

Promise.all([loadStatus(), loadProjects()]).then(loadCandidates).catch((error) => showToast(error.message, "error"));
