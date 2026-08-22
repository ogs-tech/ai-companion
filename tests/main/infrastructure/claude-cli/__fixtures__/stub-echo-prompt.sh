#!/bin/sh
# Called as: stub-echo-prompt.sh -p <prompt> --output-format stream-json ...
# Naive: assumes the test prompt has no characters that need JSON-escaping.
echo "{\"type\":\"result\",\"is_error\":false,\"result\":\"$2\"}"
exit 0
