// Central app state: a project branch (persisted, `dirty` tracked) and a ui
// branch (transient: active view, open dialogs, linking-in-progress, etc).
// Framework-agnostic on purpose -- no DOM, no Lit -- so it stays trivially
// testable and so db.js only ever has to exchange plain project objects with
// it. Delivery into the component tree happens via state/context.js +
// state/store-controller.js, not by importing a singleton everywhere.
'use strict';

import * as model from '../data/project-model.js';
import { mergeProjects, commitMergedProject } from '../data/merge.js';
import { getParsed } from '../fountain/cache.js';
import { scenesOf } from '../fountain/blocks.js';
import { computeResolved, coverage, labelScenes } from './selectors.js';
import { defaultLayout, hasContent, firstLeafId, splitLeafAt } from '../data/layout-tree.js';
import { trackVirtualView, trackStoryboardLinkAdd, trackResearchLinkAdd, trackScriptParse } from '../utils/analytics.js';

export class PandemoniumStore extends EventTarget {
  #project = null;
  #ui = null;
  #finalStateCache = null;
  #textEmitTimer = 0;

  get project() { return this.#project; }
  get ui() { return this.#ui; }

  // ---- lifecycle ----

  loadProject(rawProject) {
    const project = Object.assign(
      { name: 'Untitled', workspace: '', type: '', targetMins: 0, contributors: [], scripts: [], boards: [], research: [], folders: [], links: [], comments: [], layout: null },
      rawProject,
    );
    // Projects saved before a storyboard held both its frames are one board
    // per frame; fold them (a no-op for anything already in the new shape).
    this.#project = model.migrateBoards(project);
    // Seeded rather than defaulted in the Object.assign above, so a project
    // file written before `layout` existed (no key at all) and one written
    // with an explicit null both land on a real tree.
    if (!this.#project.layout) this.#project = { ...this.#project, layout: defaultLayout() };
    if (!this.#project.scripts.length) {
      // A brand-new project opens with two drafts already on the tab bar:
      // "First Draft" to write in, and "Final Draft" as the one that will
      // own storyboard/research links once it exists. Anything added later
      // lands between them (see insertDraft in project-model.js).
      const first = model.createScript(this.#project, { name: model.FIRST_DRAFT_NAME, final: false });
      const withFirst = first.project;
      const final = model.createScript(withFirst, { final: true });
      this.#project = final.project;
    }
    if (!this.#project.scripts.some((s) => s.final)) {
      this.#project = { ...this.#project, scripts: this.#project.scripts.map((s, ix) => (ix === 0 ? { ...s, final: true } : s)) };
    }
    this.#project = model.normalizeDraftNames(this.#project);
    this.#ui = defaultUI(this.#project.scripts.find((s) => s.final).id);
    this.#trackScriptParse(this.finalScript(), 'project_open');
    this.#trackViewChange();
    this.#emit();
  }

  closeProject() {
    this.#project = null;
    this.#ui = null;
    this.#trackViewChange();
    this.#emit();
  }

  markSaved() {
    this.#ui = { ...this.#ui, dirty: false };
    this.#emit();
  }

  // ---- derived reads ----

  finalScript() {
    if (!this.#project) return null;
    return this.#project.scripts.find((s) => s.final) || this.#project.scripts[0] || null;
  }

  activeScript() {
    if (!this.#project) return null;
    return this.#project.scripts.find((s) => s.id === this.#ui.draftId) || this.finalScript();
  }

  // The draft shown in a specific pane. Each script pane can hold a different
  // draft (open Draft 7 beside the Final Draft), so the draft selection is
  // per-leaf, overriding the global draftId. A pane with no explicit choice
  // falls back to activeScript(), so a single-pane layout behaves exactly as
  // before and every "jump to the final draft" action still lands.
  scriptForLeaf(leafId) {
    if (!this.#project) return null;
    const id = leafId && this.#ui.paneDrafts && this.#ui.paneDrafts[leafId];
    return this.#project.scripts.find((s) => s.id === id) || this.activeScript();
  }

  setPaneDraft(leafId, id) {
    // A References filter that is limited to a draft follows the writer when
    // they switch drafts, since it means "the draft I am in".
    this.setUI({ paneDrafts: { ...this.#ui.paneDrafts, [leafId]: id }, pair: null, ...(this.#ui.refDraft ? { refDraft: id } : {}) });
  }

  // The structural path for whatever is on screen, e.g. '/project/boards'.
  // Shared by the analytics view tracking below and by a beta bug report,
  // which needs to say what the tester was looking at. The app is a single
  // URL, so location.pathname cannot answer this.
  viewPath() {
    return viewInfo(this.#project, this.#ui).path;
  }

  // Everything derived from the final draft: its parsed blocks, its scenes
  // (numbered, with boarded/sourced coverage), and every board/link anchor
  // resolved against it (see selectors.js). Multiple panels read this on
  // every render (timeline, boards, script highlighting, research pairing),
  // so it is memoized on project+ui identity rather than recomputed by each
  // component -- mirrors the original renderAll()'s single shared `LAST`.
  getFinalState() {
    if (!this.#project) return null;
    const cache = this.#finalStateCache;
    if (cache && cache.project === this.#project && cache.ui === this.#ui) return cache.result;
    const fsc = this.finalScript();
    const fparsed = getParsed(fsc);
    const fscenes = labelScenes(scenesOf(fparsed));
    // Only the final draft's own links count here: a link made in another
    // draft anchors to that draft's text, and must neither paint highlights on
    // the final draft nor count towards the timeline (which is about the final
    // draft, per hard rule 3). See getDraftState for those.
    const own = { ...this.#project, links: this.#project.links.filter((l) => !l.scriptId || l.scriptId === fsc.id) };
    const R = computeResolved(fparsed, fscenes, own, this.#linkingFor(fsc.id));
    coverage(fscenes, R);
    const result = { fsc, fparsed, fscenes, R };
    this.#finalStateCache = { project: this.#project, ui: this.#ui, result };
    return result;
  }

  // The link-in-progress belongs to the draft it was started in: a passage
  // picked in Draft 2 must not also light up (wrongly) in the final draft.
  #linkingFor(scriptId) {
    const ui = this.#ui;
    const l = ui.linking;
    if (!l || l.from !== 'script') return ui;
    const owner = l.scriptId || this.finalScript().id;
    return owner === scriptId ? ui : { ...ui, linking: null };
  }

  // The same derived state for a draft that is not the final one: its own
  // reference links resolved against its own text. No boards, comments or
  // coverage: those belong to the final draft alone.
  #draftStateCache = new Map();
  getDraftState(scriptId) {
    if (!this.#project) return null;
    const fsc = this.finalScript();
    if (!scriptId || scriptId === fsc.id) return this.getFinalState();
    const sc = this.#project.scripts.find((x) => x.id === scriptId);
    if (!sc) return this.getFinalState();
    const hit = this.#draftStateCache.get(scriptId);
    if (hit && hit.project === this.#project && hit.ui === this.#ui && hit.text === sc.text) return hit.result;
    const parsed = getParsed(sc);
    const scenes = labelScenes(scenesOf(parsed));
    const mine = { ...this.#project, boards: [], comments: [], links: this.#project.links.filter((l) => l.scriptId === scriptId) };
    const R = computeResolved(parsed, scenes, mine, this.#linkingFor(scriptId));
    const result = { sc, parsed, scenes, R };
    this.#draftStateCache.set(scriptId, { project: this.#project, ui: this.#ui, text: sc.text, result });
    return result;
  }

  // Every link a reference has, across all drafts, each with the draft it is
  // in and whether its passage can still be found there.
  researchLinks(researchId) {
    if (!this.#project) return [];
    const fsc = this.finalScript();
    const owners = new Set();
    for (const l of this.#project.links) {
      if (l.researchId !== researchId) continue;
      owners.add(l.scriptId && this.#project.scripts.some((x) => x.id === l.scriptId) ? l.scriptId : fsc.id);
    }
    const out = [];
    for (const id of owners) {
      const st = id === fsc.id ? this.getFinalState() : this.getDraftState(id);
      const script = id === fsc.id ? fsc : st.sc;
      for (const it of st.R.links) if (it.lk.researchId === researchId) out.push({ ...it, script });
    }
    return out;
  }

  // ---- internal ----

  #emit(kind) {
    this.dispatchEvent(new CustomEvent('change', { detail: { kind } }));
  }

  // Analytics hooks. Both are fire-and-forget and no-op when GA4 is not
  // configured, so nothing here can affect a mutation's outcome.
  #trackViewChange() {
    const info = viewInfo(this.#project, this.#ui);
    trackVirtualView(info.title, { page_path: info.path });
  }

  // Deliberately NOT in fountain/cache.js: getParsed() is a render-path
  // memoization seam that misses on every keystroke, so hooking it there sent
  // one event per edit tick. It also has to stay DOM-free and dependency-free.
  // A parse is only a user-facing event when a script first arrives.
  #trackScriptParse(script, source) {
    if (!script) return;
    const parsed = getParsed(script);
    trackScriptParse({
      source,
      script_id: script.id,
      script_final: !!script.final,
      block_count: parsed.blocks.length,
    });
  }

  #applyProject(next) {
    this.#project = next;
    this.#ui = { ...this.#ui, dirty: true };
    this.#emit('project');
  }

  #applyUI(next) {
    this.#ui = next;
    this.#emit('ui');
  }

  setUI(patch) {
    const prev = this.#ui;
    const next = { ...this.#ui, ...patch };
    this.#applyUI(next);
    if (prev && viewPatchAffectsView(prev, next)) this.#trackViewChange();
  }

  // ---- script actions ----

  createScript(opts) {
    const { project, script } = model.createScript(this.#project, opts);
    this.#applyProject(project);
    return script;
  }

  renameScript(id, name) { this.#applyProject(model.renameScript(this.#project, id, name)); }

  reorderScript(id, beforeId) { this.#applyProject(model.reorderScript(this.#project, id, beforeId)); }

  // Used by the live textarea/editor: the underlying text is always written
  // synchronously (so `store.project` is instantly current for Save/export,
  // never lagging behind what's on screen), but the 'change' notification
  // that triggers other components' re-render (timeline, boards panel) is
  // debounced, since those are comparatively expensive to redo on every
  // keystroke. Mirrors the original's `sc.text = value` (sync) followed by
  // a debounced `editorSync()`.
  updateScriptTextLive(id, text) {
    this.#project = model.updateScriptText(this.#project, id, text);
    this.#ui = { ...this.#ui, dirty: true };
    clearTimeout(this.#textEmitTimer);
    this.#textEmitTimer = setTimeout(() => this.#emit('project'), 250);
  }

  // Like updateScriptTextLive, but also swaps in already-remapped boards/links
  // arrays in the same synchronous project update. The editor calls this after
  // an edit so a link/board anchored to text the user just typed inside keeps
  // pointing at it (its stored quote is re-derived from the edited text) rather
  // than going "lost" -- see script-editor.js #remapAnchors and hard rule 4.
  // Pass null for boards/links to leave that branch untouched.
  applyLiveEdit(id, text, boards, links, comments) {
    let next = model.updateScriptText(this.#project, id, text);
    if (boards) next = { ...next, boards };
    if (links) next = { ...next, links };
    if (comments) next = { ...next, comments };
    this.#project = next;
    this.#ui = { ...this.#ui, dirty: true };
    clearTimeout(this.#textEmitTimer);
    this.#textEmitTimer = setTimeout(() => this.#emit('project'), 250);
  }

  duplicateScript(id) {
    const { project, script } = model.duplicateScript(this.#project, id);
    this.#applyProject(project);
    return script;
  }
  deleteScript(id) {
    this.#applyProject(model.deleteScript(this.#project, id));
    const patch = {};
    if (this.#ui.draftId === id) patch.draftId = this.finalScript().id;
    // Drop any pane that was showing the deleted draft so it falls back to the
    // final draft rather than pointing at a script that no longer exists.
    const panes = this.#ui.paneDrafts || {};
    if (Object.values(panes).includes(id)) {
      patch.paneDrafts = Object.fromEntries(Object.entries(panes).filter(([, v]) => v !== id));
    }
    if (Object.keys(patch).length) this.setUI(patch);
  }
  makeFinal(id) { this.#applyProject(model.makeFinal(this.#project, id)); }
  setBoardDuration(id, secs) { this.#applyProject(model.setBoardDuration(this.#project, id, secs)); }
  // Where image drops from the editor/timeline land: the reference storyboard
  // (default) or the final one. Persisted with the project.
  setDropToReference(v) { this.#applyProject({ ...this.#project, dropToReference: !!v }); }
  updateScriptText(id, text) { this.#applyProject(model.updateScriptText(this.#project, id, text)); }
  importFountain(name, text) {
    const { project, script } = model.importFountain(this.#project, name, text);
    this.#applyProject(project);
    this.#trackScriptParse(script, 'import');
    return script;
  }

  // ---- board actions ----

  // `opts.mode` ('final' | 'reference') picks which frame the image goes in;
  // the other frame exists, empty. See the storyboard note in project-model.js.
  addBoard(opts) {
    const { project, board } = model.addBoard(this.#project, opts);
    this.#applyProject(project);
    this.#trackBoardLink(opts, project);
    return board;
  }

  // Put an image in one frame of the storyboard already on this passage if that
  // frame is empty (so a beat's final and reference stay together), else start
  // a new storyboard. The drop and paste paths use this rather than addBoard.
  placeFrame(opts) {
    const { project, board } = model.placeFrame(this.#project, opts);
    this.#applyProject(project);
    this.#trackBoardLink(opts, project);
    return board;
  }

  // A storyboard with no image in either frame, made from a script section. It
  // is a real storyboard link (the section is claimed), so it is tracked as
  // one, but coverage() will not let it into the boarded percentage until its
  // final frame has an image. `opts.note` is the storyboard's own comment.
  addBlankBoard(opts) {
    const { project, board } = model.addBlankBoard(this.#project, opts);
    this.#applyProject(project);
    this.#trackBoardLink(opts, project);
    return board;
  }

  // An image with no anchor is not yet a storyboard *link*: only a storyboard
  // attached to a script passage counts.
  #trackBoardLink(opts, project) {
    const parts = (opts.parts || []).length;
    if (parts) trackStoryboardLinkAdd({ script_parts: parts, board_count: project.boards.length });
  }

  reorderBoard(id, delta) { this.#applyProject(model.reorderBoard(this.#project, id, delta)); }
  updateBoardCaption(id, caption) { this.#applyProject(model.updateBoardCaption(this.#project, id, caption)); }
  setBoardNote(id, note) { this.#applyProject(model.setBoardNote(this.#project, id, note)); }
  // Set or clear ONE frame ('final' by default); the other is untouched.
  replaceBoardImage(id, img, mode) { this.#applyProject(model.replaceBoardImage(this.#project, id, img, mode)); }
  // Swap a storyboard's two frames; with one empty this moves the image across.
  swapBoardFrames(id) { this.#applyProject(model.swapBoardFrames(this.#project, id)); }
  reattachBoard(id, parts) { this.#applyProject(model.reattachBoard(this.#project, id, parts)); }
  deleteBoard(id) { this.#applyProject(model.deleteBoard(this.#project, id)); }

  // ---- research actions ----

  addResearch(opts) {
    const { project, doc } = model.addResearch(this.#project, opts);
    this.#applyProject(project);
    return doc;
  }
  // Patch any subset of a source's fields ({title, body, url, color,
  // attachment}); `kind` re-derives itself from the result.
  updateResearch(id, patch) { this.#applyProject(model.updateResearch(this.#project, id, patch)); }
  deleteResearch(id) {
    this.#applyProject(model.deleteResearch(this.#project, id));
    if (this.#ui.openDoc === id) this.setUI({ openDoc: null });
  }

  // ---- folder actions (organising references) ----

  addFolder(opts) {
    const { project, folder } = model.addFolder(this.#project, opts);
    this.#applyProject(project);
    return folder;
  }
  updateFolder(id, patch) { this.#applyProject(model.updateFolder(this.#project, id, patch)); }
  moveFolder(id, parentId) { this.#applyProject(model.moveFolder(this.#project, id, parentId)); }
  moveResearch(id, folderId) { this.#applyProject(model.moveResearch(this.#project, id, folderId)); }
  deleteFolder(id) { this.#applyProject(model.deleteFolder(this.#project, id)); }

  // ---- link actions ----

  addLink(opts) {
    // Only a draft other than the final one is recorded on the link; the final
    // draft's links stay unmarked so they follow it (see model.addLink).
    const scriptId = opts.scriptId && opts.scriptId !== this.finalScript().id ? opts.scriptId : null;
    const { project, link } = model.addLink(this.#project, { ...opts, scriptId });
    this.#applyProject(project);
    trackResearchLinkAdd({
      script_parts: (opts.sParts || []).length,
      // Whether the research end is a highlighted span or the whole doc.
      two_ended: !!(opts.rParts || []).length,
      link_count: project.links.length,
    });
    return link;
  }
  reattachLink(id, parts) { this.#applyProject(model.reattachLink(this.#project, id, parts)); }
  deleteLink(id) { this.#applyProject(model.deleteLink(this.#project, id)); }

  // ---- comment actions ----

  addComment(opts) {
    const { project, comment } = model.addComment(this.#project, opts);
    this.#applyProject(project);
    return comment;
  }
  updateCommentBody(id, body) { this.#applyProject(model.updateCommentBody(this.#project, id, body)); }
  reattachComment(id, parts) { this.#applyProject(model.reattachComment(this.#project, id, parts)); }
  deleteComment(id) { this.#applyProject(model.deleteComment(this.#project, id)); }

  // ---- layout ----

  // The panel arrangement is persisted project state, so it goes through
  // #applyProject like any other edit: it marks the project dirty and rides
  // the same autosave. Because it left the ui branch, setUI no longer sees
  // layout changes, so the virtual-view tracking that used to happen there is
  // re-asserted here.
  setLayout(layout) {
    if (!this.#project || !layout) return;
    const before = layoutSignature(this.#project.layout);
    this.#applyProject(model.setLayout(this.#project, layout));
    if (before !== layoutSignature(layout)) this.#trackViewChange();
  }

  // Make sure a panel of `content` is on screen, opening one beside the first
  // pane if none shows it yet. Used when an action produces something the user
  // should now see (linking a passage to a storyboard opens the boards panel).
  revealContent(content) {
    if (!this.#project) return;
    const layout = this.#project.layout || defaultLayout();
    if (hasContent(layout, content)) return;
    // Split the top-left pane, putting the revealed panel on its right at ~40%.
    this.setLayout(splitLeafAt(layout, firstLeafId(layout), 'row', 0.4, false, content));
  }

  // ---- sync merge ----

  // A 409 from the backend arrives here (via app-root's conflict handler)
  // as {base, mine, theirs, theirUpdatedAt}. When the merge is clean it is
  // applied immediately and returned so the caller can push it back up with
  // the right concurrency token; when it is not, the whole merge result goes
  // into transient ui state and the merge dialog takes over.
  //
  // ui.merge is transient BY DESIGN: an unresolved merge is a live
  // negotiation, and persisting it would let a half-merged project autosave
  // itself into the account, which is the one outcome worse than the
  // conflict itself.
  beginMerge({ base, mine, theirs, theirUpdatedAt }) {
    // All three sides go through the same migration first: the other device
    // may not have updated yet, and merging an old-shape board against a
    // new-shape one would read every storyboard as edited on both sides.
    const result = mergeProjects(
      base ? model.migrateBoards(base) : null,
      model.migrateBoards(mine),
      model.migrateBoards(theirs),
    );
    if (result.clean) {
      this.#project = model.normalizeDraftNames(result.project);
      this.#ui = { ...this.#ui, dirty: true };
      this.#emit('project');
      return { clean: true, project: this.#project, theirUpdatedAt };
    }
    this.setUI({ merge: { result, theirUpdatedAt } });
    return { clean: false };
  }

  resolveMergeHunk(index, resolution) {
    const m = this.#ui.merge;
    if (!m || !m.result.hunks[index]) return;
    const hunks = m.result.hunks.map((h, ix) => (ix === index ? { ...h, resolution } : h));
    this.setUI({ merge: { ...m, result: { ...m.result, hunks } } });
  }

  // Refuses while anything is unresolved (commitMergedProject returns null),
  // so the dialog cannot be talked into a silent choice. Hard rule 4 is
  // re-normalized here because a merge can legitimately arrive with two
  // promoted finals; commitMergedProject settles the flag and
  // normalizeDraftNames settles the names.
  commitMerge() {
    const m = this.#ui.merge;
    if (!m) return null;
    const project = commitMergedProject(m.result);
    if (!project) return null;
    this.#project = model.normalizeDraftNames(project);
    this.#ui = { ...this.#ui, merge: null, dirty: true };
    this.#emit('project');
    return { project: this.#project, theirUpdatedAt: m.theirUpdatedAt };
  }

  // Postponing is safe: nothing was written, the local state stays as it was,
  // and the next autosave will 409 again and reopen the same negotiation.
  cancelMerge() { this.setUI({ merge: null }); }

  // ---- project meta ----

  updateProjectMeta(patch) { this.#applyProject(model.updateProjectMeta(this.#project, patch)); }
  addContributor(name) { this.#applyProject(model.addContributor(this.#project, name)); }
  removeContributor(index) { this.#applyProject(model.removeContributor(this.#project, index)); }
  setContributors(contributors) { this.#applyProject(model.setContributors(this.#project, contributors)); }
}

function defaultUI(draftId) {
  return {
    draftId,
    paneDrafts: {}, // { [leafId]: scriptId } -- per-pane draft override (see scriptForLeaf)
    openDoc: null,
    // A source that was just created opens with the caret already in its
    // notes. There is no reader "edit mode" for this to be confused with any
    // more: a source's notes are always editable in place, so this says where
    // to start, not what is permitted.
    openDocFocus: false,
    // The draft whose references the References panel is limited to, or null
    // for all of them. Transient, like every other view filter.
    refDraft: null,
    linking: null, // {from:'script', parts} | {from:'research', docId, rParts}
    pair: null, // id of the link currently shown with its connector
    pendingRelink: null, // {type:'board'|'link', id} -- reattaching an existing board/link to a new passage
    scrollToBlock: null,
    scrollToParagraph: null,
    highlightBoard: null,
    // Which storyboard tab ('final' | 'reference') the boards panel should switch
    // to while it scrolls to and flashes highlightBoard; null leaves it as is.
    highlightMode: null,
    merge: null, // {result: mergeProjects() output, theirUpdatedAt} while a sync conflict awaits resolution
    dirty: false,
    // Id of a leaf temporarily shown alone (focused writing mode), or null.
    // Transient and per-session like everything else in ui: the saved split
    // tree (project.layout) is never touched by focusing a pane.
    focusedLeaf: null,
  };
}

// Layout is deliberately absent here: it is project state now, and setLayout
// reports its own view change.
function viewPatchAffectsView(prev, next) {
  return prev.draftId !== next.draftId || prev.paneDrafts !== next.paneDrafts || prev.openDoc !== next.openDoc;
}

// A virtual view is described structurally: which panel arrangement is on
// screen, and whether a research source is open.
//
// Deliberately no project name, script name, or research doc title. Those are
// the user's unreleased screenplay material and must not leave the browser in
// an analytics payload. It also keeps the GA4 report readable: per-project
// paths would shard every row into a long tail of one-off URLs.
function viewInfo(project, ui) {
  if (!project || !ui) return { title: 'Start screen', path: '/start' };
  // One view, not a read one and a write one: the reader has no modes.
  if (ui.openDoc) return { title: 'Research source', path: '/project/research/source' };
  const layout = project.layout;
  const singleLeaf = layout && layout.type === 'leaf';
  if (!singleLeaf) return { title: 'Workspace', path: '/project/workspace' };
  const content = layout.content;
  const title = content === 'boards' ? 'Storyboard'
    : content === 'research' ? 'Research'
      : content === 'timeline' ? 'Timeline' : 'Script';
  return { title, path: '/project/' + content };
}

function layoutSignature(node) {
  if (!node) return '';
  if (node.type === 'leaf') return 'leaf:' + node.content;
  return node.dir + '(' + layoutSignature(node.a) + ',' + layoutSignature(node.b) + ')';
}
