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
      { name: 'Untitled', workspace: '', type: '', targetMins: 0, contributors: [], scripts: [], boards: [], research: [], links: [] },
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
    this.#ui = defaultUI(this.#project.scripts.find((s) => s.final).id);
    this.#emit();
  }

  closeProject() {
    this.#project = null;
    this.#ui = null;
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
    this.#applyUI({ ...this.#ui, ...patch });
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
    return script;
  }

  // ---- board actions ----

  addBoard(opts) {
    const { project, board } = model.addBoard(this.#project, opts);
    this.#applyProject(project);
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
    return link;
  }
  reattachLink(id, parts) { this.#applyProject(model.reattachLink(this.#project, id, parts)); }
  deleteLink(id) { this.#applyProject(model.deleteLink(this.#project, id)); }

  // ---- project meta ----

  updateProjectMeta(patch) { this.#applyProject(model.updateProjectMeta(this.#project, patch)); }
  addContributor(name) { this.#applyProject(model.addContributor(this.#project, name)); }
  removeContributor(index) { this.#applyProject(model.removeContributor(this.#project, index)); }
  setContributors(contributors) { this.#applyProject(model.setContributors(this.#project, contributors)); }
}

function defaultUI(draftId) {
  return {
    view: 'everything', // 'everything' | 'split' | 'single'
    split: 'research', // which panel shares the split view with script: 'boards' | 'research'
    draftId,
    edit: false, // Phase 1 only: script panel Preview/Edit toggle, removed in Phase 3
    openDoc: null,
    readerEdit: false,
    linking: null, // {from:'script', parts} | {from:'research', docId, rParts}
    pair: null, // id of the link currently shown with its connector
    pendingRelink: null, // {type:'new-board'} | {type:'board'|'link', id}
    scrollToBlock: null,
    scrollToParagraph: null,
    highlightBoard: null,
    searchOpen: false,
    dirty: false,
  };
}
