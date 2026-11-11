export interface Me {
  id: number;
  name: string;
  admin: boolean;
  teacher: boolean;
  projectId: number | null;
  impersonated: boolean;
}

export interface ProjectListItem {
  id: number;
  title: string;
  mode: 'group' | 'single';
  contextId: number;
  role: 'teacher' | 'student';
  createdAt: number;
  /** Kennzahlen für das Portal, nur bei eigenen Projekten als Lehrkraft */
  summary?: ProjectSummary | null;
}

export interface ProjectSummary {
  subject: string | null;
  phases: ProjectSettings['phases'];
  students: number;
  unassigned: number;
  groups: number;
  docs: number;
  done: number;
  /** Fertig-Meldungen seit dem letzten Besuch im Portal */
  newDone: number;
}

export interface Course {
  id: number;
  title: string;
  moodle: boolean;
}

export interface BoardGroup {
  id: number;
  title: string;
  position: number;
  color: string | null;
}

export interface BoardMember {
  userId: number;
  name: string;
  groupId: number | null;
  position: number;
  roleLabel: string | null;
}

export interface Board {
  projectId: number;
  mode: 'group' | 'single';
  groups: BoardGroup[];
  members: BoardMember[];
}

export type GroupFormation = 'teacher' | 'choice' | 'open';

export interface ProjectSettings {
  brief: string;
  subject: string | null;
  groupFormation: GroupFormation;
  groupMin: number;
  groupMax: number;
  choiceDeadline: number | null;
  studentsSetTopic: boolean;
  roles: string[];
  freeRoles: boolean;
  phases: Record<string, { state: 'on' | 'scheduled' | 'off'; from: number | null; to: number | null }>;
  docTypes: Record<string, boolean>;
  importTypes: Record<string, boolean>;
  exportFormats: Record<string, boolean>;
  maxFileMb: number;
  formulaTransform: boolean;
  formulaCalc: boolean;
  finishLock: boolean;
  reopenBy: 'teacher' | 'group';
  pasteThreshold: number;
  pasteExplain: boolean;
  logbookRequired: boolean;
  aiFeedback: boolean;
  aiDailyLimit: number;
}

export interface ProjectView {
  id: number;
  title: string;
  mode: 'group' | 'single';
  settings: ProjectSettings;
  course: { id: number; title: string; moodle: boolean };
  role: 'teacher' | 'student';
  myGroupId: number | null;
  board: Board;
  codesValidUntil?: Record<number, number>;
}

export interface Frame {
  docTypes: Record<string, boolean>;
  importTypes: Record<string, boolean>;
  exportFormats: Record<string, boolean>;
  maxFileMb: number;
  ai: boolean;
  typingHints: 'off' | 'students' | 'students_teachers';
  openOffice: boolean;
}

/** Mindmap (Phase Orientierung), wie vom Server verteilt (server/src/projects/maps.ts). */
export interface MapCard {
  id: string;
  kind: 'card' | 'cluster';
  title: string;
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string | null;
  parent: string | null;
  owner: number | null;
  shape?: MapShape;
  route?: MapRoute;
  bend?: number;
  bx?: number | null;
  by?: number | null;
  start?: MapStart | null;
  via?: [number, number][];
  children: string[];
}
export interface MapStart {
  side: 't' | 'r' | 'b' | 'l';
  t: number;
}
export type MapRoute = 'metro' | 'ortho' | 'curve' | 'straight';
export type MapShape = 'none' | 'rect' | 'oval' | 'diamond' | 'para';
export interface MapLink {
  id: string;
  from: string;
  to: string;
}
export interface OutlineSection {
  id: string;
  title: string;
  cards: string[];
  owners: number[];
}
export interface MindMap {
  v: 1;
  cards: Record<string, MapCard>;
  roots: string[];
  links: MapLink[];
  outline: { sections: OutlineSection[]; at: number; by: number } | null;
}
export type MapOp =
  | { type: 'add'; card: Omit<MapCard, 'children'> }
  | { type: 'update'; id: string; patch: Partial<Pick<MapCard, 'title' | 'text' | 'color' | 'owner' | 'w' | 'h' | 'shape' | 'route' | 'bend' | 'bx' | 'by' | 'start' | 'via'>> }
  | { type: 'move'; id: string; x: number; y: number; parent: string | null }
  | { type: 'remove'; ids: string[] }
  | { type: 'link'; id: string; from: string; to: string }
  | { type: 'unlink'; id: string }
  | { type: 'outline' };
