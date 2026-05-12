export interface IFileNode {
  path: string;
  size: number;
  updatedAt: Date;
}

export interface IFileContent {
  path: string;
  content: string;
  size: number;
  updatedAt: Date;
}

// Primitive shape passed to syncSkills — kept local to the file slice
// so the gateway doesn't depend on the skill slice's types directly.
export interface ISkillBundle {
  name: string;
  body: string;
  files: { path: string; content: string }[];
}
