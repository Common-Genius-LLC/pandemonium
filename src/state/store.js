// Central app state: a project branch (persisted, `dirty` tracked) and a ui
// branch (transient: active view, open dialogs, linking-in-progress, etc).
// Framework-agnostic on purpose -- no DOM, no Lit -- so it stays trivially
// testable and so db.js only ever has to exchange plain project objects with
// it. Delivery into the component tree happens via state/context.js +
// state/store-controller.js, not by importing a singleton everywhere.
'use strict';

import * as model from '../data/project-model.js';
import { getParsed } from '../fountain/cache.js';
import { scenesOf } from '../fountain/blocks.js';
import { computeResolved, coverage, labelScenes } from './selectors.js';
import { defaultLayout } from '../data/layout-tree.js';
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
      { name: 'Untitled', workspace: '', type: '', targetMins: 0, contributors: [], scripts: [], boards: [], research: [], links: [], comments: [] },
      rawProject,
    );
    this.#project = project;
    if (!this.#project.scripts.length) {
      const created = model.createScript(this.#project, {});
      this.#project = created.project;
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
  // every render (timesheet, boards, script highlighting, research pairing),
  // so it is memoized on project+ui identity rather than recomputed by each
  // component -- mirrors the original renderAll()'s single shared `LAST`.
  getFinalState() {
    if (!this.#project) return null;
    const cache = this.#finalStateCache;
    if (cache && cache.project === this.#project && cache.ui === this.#ui) return cache.result;
    const fsc = this.finalScript();
    const fparsed = getParsed(fsc);
    const fscenes = labelScenes(scenesOf(fparsed));
    const R = computeResolved(fparsed, fscenes, this.#project, this.#ui);
    coverage(fscenes, R);
    const result = { fsc, fparsed, fscenes, R };
    this.#finalStateCache = { project: this.#project, ui: this.#ui, result };
    return result;
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

  // Used by the live textarea/editor: the underlying text is always written
  // synchronously (so `store.project` is instantly current for Save/export,
  // never lagging behind what's on screen), but the 'change' notification
  // that triggers other components' re-render (timesheet, boards panel) is
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
    if (this.#ui.draftId === id) this.setUI({ draftId: this.finalScript().id });
  }
  makeFinal(id) { this.#applyProject(model.makeFinal(this.#project, id)); }
  updateScriptText(id, text) { this.#applyProject(model.updateScriptText(this.#project, id, text)); }
  importFountain(name, text) {
    const { project, script } = model.importFountain(this.#project, name, text);
    this.#applyProject(project);
    this.#trackScriptParse(script, 'import');
    return script;
  }

  // ---- board actions ----

  addBoard(opts) {
    const { project, board } = model.addBoard(this.#project, opts);
    this.#applyProject(project);
    // An image dropped into the boards panel with no anchor is not yet a
    // storyboard *link*: only a board attached to a script passage counts.
    const parts = (opts.parts || []).length;
    if (parts) trackStoryboardLinkAdd({ script_parts: parts, board_count: project.boards.length });
    return board;
  }
  updateBoardCaption(id, caption) { this.#applyProject(model.updateBoardCaption(this.#project, id, caption)); }
  replaceBoardImage(id, img) { this.#applyProject(model.replaceBoardImage(this.#project, id, img)); }
  reattachBoard(id, parts) { this.#applyProject(model.reattachBoard(this.#project, id, parts)); }
  deleteBoard(id) { this.#applyProject(model.deleteBoard(this.#project, id)); }

  // ---- research actions ----

  addResearch(opts) {
    const { project, doc } = model.addResearch(this.#project, opts);
    this.#applyProject(project);
    return doc;
  }
  updateResearchTitle(id, title) { this.#applyProject(model.updateResearchTitle(this.#project, id, title)); }
  updateResearchBody(id, body) { this.#applyProject(model.updateResearchBody(this.#project, id, body)); }
  deleteResearch(id) {
    this.#applyProject(model.deleteResearch(this.#project, id));
    if (this.#ui.openDoc === id) this.setUI({ openDoc: null });
  }

  // ---- link actions ----

  addLink(opts) {
    const { project, link } = model.addLink(this.#project, opts);
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

  // ---- project meta ----

  updateProjectMeta(patch) { this.#applyProject(model.updateProjectMeta(this.#project, patch)); }
  addContributor(name) { this.#applyProject(model.addContributor(this.#project, name)); }
  removeContributor(index) { this.#applyProject(model.removeContributor(this.#project, index)); }
  setContributors(contributors) { this.#applyProject(model.setContributors(this.#project, contributors)); }
}

function defaultUI(draftId) {
  return {
    // Blender-style window division (see data/layout-tree.js): a binary split
    // tree of resizable panes, each showing any panel type, replaces the old
    // everything/split/single view modes. Transient ui state, like the modes
    // it replaced (resets on reload).
    layout: defaultLayout(),
    draftId,
    openDoc: null,
    readerEdit: false,
    linking: null, // {from:'script', parts} | {from:'research', docId, rParts}
    pair: null, // id of the link currently shown with its connector
    pendingRelink: null, // {type:'board'|'link', id} -- reattaching an existing board/link to a new passage
    scrollToBlock: null,
    scrollToParagraph: null,
    highlightBoard: null,
    dirty: false,
  };
}

function viewPatchAffectsView(prev, next) {
  return prev.draftId !== next.draftId || prev.openDoc !== next.openDoc || prev.readerEdit !== next.readerEdit || layoutSignature(prev.layout) !== layoutSignature(next.layout);
}

// A virtual view is described structurally: which panel arrangement is on
// screen, and whether a research doc is open for reading or editing.
//
// Deliberately no project name, script name, or research doc title. Those are
// the user's unreleased screenplay material and must not leave the browser in
// an analytics payload. It also keeps the GA4 report readable: per-project
// paths would shard every row into a long tail of one-off URLs.
function viewInfo(project, ui) {
  if (!project || !ui) return { title: 'Start screen', path: '/start' };
  if (ui.openDoc) {
    const mode = ui.readerEdit ? 'edit' : 'read';
    return { title: 'Research ' + mode, path: '/project/research/' + mode };
  }
  const singleLeaf = ui.layout && ui.layout.type === 'leaf';
  if (!singleLeaf) return { title: 'Workspace', path: '/project/workspace' };
  const content = ui.layout.content;
  const title = content === 'boards' ? 'Storyboard' : content === 'research' ? 'Research' : 'Script';
  return { title, path: '/project/' + content };
}

function layoutSignature(node) {
  if (!node) return '';
  if (node.type === 'leaf') return 'leaf:' + node.content;
  return node.dir + '(' + layoutSignature(node.a) + ',' + layoutSignature(node.b) + ')';
}
