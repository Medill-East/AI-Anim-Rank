export interface ProgressRecord {
  workId: string;
  watched: boolean;
  reviewed: boolean;
  recommended: boolean;
  notInterested: boolean;
  note?: string;
  updatedAt: string;
  revision: number;
}

export type ProgressPatch = Partial<
  Pick<ProgressRecord, "watched" | "reviewed" | "recommended" | "notInterested" | "note">
>;

export function applyProgressPatch(
  existing: ProgressRecord,
  patch: ProgressPatch,
  updatedAt: string,
): ProgressRecord {
  const noteIncluded = Object.hasOwn(patch, "note");
  const next: ProgressRecord = {
    ...existing,
    ...patch,
  };

  if (next.reviewed || next.recommended) {
    next.watched = true;
  }

  if (next.recommended && next.notInterested) {
    if (patch.notInterested === true) {
      next.recommended = false;
    } else {
      next.notInterested = false;
    }
  }

  if (noteIncluded && !patch.note?.trim()) {
    delete next.note;
  } else if (noteIncluded) {
    next.note = patch.note?.trim();
  }

  if (sameProgressState(existing, next)) {
    return existing;
  }

  return {
    ...next,
    updatedAt,
    revision: existing.revision + 1,
  };
}

function sameProgressState(left: ProgressRecord, right: ProgressRecord): boolean {
  return (
    left.watched === right.watched &&
    left.reviewed === right.reviewed &&
    left.recommended === right.recommended &&
    left.notInterested === right.notInterested &&
    left.note === right.note
  );
}
