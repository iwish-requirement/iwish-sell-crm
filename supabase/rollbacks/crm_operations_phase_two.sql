update crm_allocation.operations_release
set enabled = false, pilot_lead_id = null, enabled_after = null
where singleton;
