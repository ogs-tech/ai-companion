#!/bin/sh
# Echoes the argv it was handed, so a test can assert the exact flags the
# adapter builds without reaching into its internals.
echo "ARGV:$*"
read line
exit 0
