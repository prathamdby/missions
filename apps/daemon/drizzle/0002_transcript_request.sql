CREATE INDEX `transcript_mission_request_idx` ON `transcript` (`mission_id`, json_extract(`data`, '$.requestId'));
