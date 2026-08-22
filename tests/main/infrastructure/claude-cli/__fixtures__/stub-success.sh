#!/bin/sh
echo '{"type":"system","subtype":"init"}'
echo '{"type":"system","subtype":"status","status":"requesting"}'
echo '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"STUB"}}}'
echo '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"_OUTPUT"}}}'
echo '{"type":"result","is_error":false,"result":"STUB_OUTPUT"}'
exit 0
