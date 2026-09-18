#!/bin/sh
# Stands in for `claude` refusing a --resume of a conversation it cannot find:
# same wording and exit code as the real CLI, so the adapter's retry path is
# exercised for real rather than against a mock.
if [ "$1" = "--resume" ]; then
  echo "No conversation found with session ID: $2"
  exit 1
fi
echo "READY"
read line
echo "ECHO:$line"
exit 7
