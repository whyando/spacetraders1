#!/bin/bash

# Run `node .` , restarting it if it crashes.
# route output to append run.log

until node src &>> run.log; do
    # print date
    echo $(date +%Y-%m-%d_%H-%M-%S)
    echo "Server 'node src' crashed with exit code $?.  Respawning.." >&2
    sleep 10
done
