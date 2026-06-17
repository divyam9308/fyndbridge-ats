-- Drop the existing unique index for read confirmations if it exists
DROP INDEX IF EXISTS notifications_read_confirmation_unique_idx;

-- Create a new unique index that includes client_id and mandate_id properly
-- For assignment read confirmations (which can be candidate, client, or mandate)
-- we want to ensure uniqueness per recipient, sender, action type, and the relevant entity (mandate or client).
-- Note: Candidate assignments might not use client_id or mandate_id directly, or they use mandate_id if it's a job.
-- To allow multiple consultants to send read receipts for the SAME candidate/client assignment to the SAME creator,
-- the uniqueness should really just be on the action_type + the specific notification being acknowledged.
-- But since we don't store the original notification_id being acknowledged, we use sender, recipient, action_type, and entity ids.

-- By including client_id and mandate_id (and treating nulls distinctly or using a coalesce), we prevent duplicate read receipts from the same user for the same assignment.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_read_confirmation_unique_idx
ON public.notifications (
  recipient_user_id, 
  sender_user_id, 
  action_type, 
  COALESCE(mandate_id, '00000000-0000-0000-0000-000000000000'::uuid), 
  COALESCE(client_id, '00000000-0000-0000-0000-000000000000'::uuid)
)
WHERE action_type IN ('assignment_read_confirmation', 'candidate_assignment_read_confirmation', 'client_assignment_read_confirmation');
