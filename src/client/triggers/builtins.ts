// Register the CODE-registered built-in triggers (PRO-1). A side-effect module (the
// ./theme/builtins idiom): importing it once at client startup arms the built-ins the
// proactive tick evaluates. PRO-1 ships exactly one — the review-push exemplar.

import { registerReviewPushTrigger } from "./reviewPush";

registerReviewPushTrigger();
