-- Restore the legacy queue and save path. Keep the cutover date and the new records for reactivation.
begin;
set local lock_timeout = '3s';
update crm_allocation.release set enabled = false where singleton;
commit;
