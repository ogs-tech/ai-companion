#!/bin/sh
# Combines stub-no-conversation.sh's "refuse the resume" behavior with
# stub-echo-args.sh's argv echo, so a test can assert exactly which flags the
# adapter's resume-fallback *retry* was called with, not just that it succeeded.
if [ "$1" = "--resume" ]; then
  echo "No conversation found with session ID: $2"
  exit 1
fi
echo "ARGV:$*"
read line
exit 0
