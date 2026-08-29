#!/bin/sh
if [ "$1" = "--continue" ]; then
  echo "No conversation found to continue"
  exit 1
fi
echo "READY"
read line
echo "ECHO:$line"
exit 7
