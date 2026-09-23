CREATE TRIGGER master_sync_users AFTER INSERT OR UPDATE OR DELETE ON users
FOR EACH ROW EXECUTE FUNCTION corepos_capture_master_sync('users');

INSERT INTO master_sync_rows(business_id,entity_type,entity_id,payload)
SELECT business_id,'users',id,to_jsonb(users)-'id' FROM users
ON CONFLICT(entity_type,business_id,entity_id) DO NOTHING;
