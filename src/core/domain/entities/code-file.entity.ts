export class CodeFile {
  constructor(
    public readonly path: string,
    public readonly content: string,
    public readonly language: string,
    public readonly changes: FileDiff[] = [],
  ) {}
}

export class FileDiff {
  constructor(
    public readonly newLineNumber: number | null,
    public readonly content: string,
    public readonly type: DiffType,
  ) {}
}

export enum DiffType {
  ADDED = 'added',
  DELETED = 'deleted',
  UNCHANGED = 'unchanged',
}