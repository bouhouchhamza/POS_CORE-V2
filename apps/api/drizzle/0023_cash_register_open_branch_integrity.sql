-- PostgreSQL unique indexes consider NULL values distinct. The original
-- (business_id, branch_id) partial index therefore allowed concurrent open
-- sessions for a branchless Business.  Zero is not a valid serial branch id,
-- so it is a stable sentinel for the intentional NULL branch scope.
CREATE UNIQUE INDEX cash_register_one_open_business_branch_coalesced_idx
  ON cash_register_sessions(business_id, coalesce(branch_id, 0))
  WHERE status = 'open';

DROP INDEX IF EXISTS cash_register_one_open_business_branch_idx;
