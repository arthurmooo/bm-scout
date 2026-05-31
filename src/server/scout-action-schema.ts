import { z } from "zod";
import { LEAD_ACTION_TYPES } from "../domain/types";

export const scoutActionSchema = z.object({
  action: z.enum(LEAD_ACTION_TYPES),
  leadId: z.string().min(1).optional(),
  note: z.string().max(600).optional(),
  reason: z.string().max(300).optional()
});
