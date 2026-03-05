export type SavePackReviewState = {
  ok: boolean;
  error: string | null;
  issues: string[];
};

export const PACK_REVIEW_INITIAL_SAVE_STATE: SavePackReviewState = {
  ok: true,
  error: null,
  issues: [],
};

export type ValidatePackJsonResult =
  | {
      ok: true;
      canonicalJson: string;
      message: string;
    }
  | {
      ok: false;
      error: string;
      issues: string[];
    };
