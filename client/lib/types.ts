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
