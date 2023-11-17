#!/bin/bash

# Run `node .` , restarting it if it crashes.
# route output to append run.log

CMD="node src THE-VOID AD-ASTRA ROQUE WHYANDO"
# CMD="node src THE-VOID AD-ASTRA ROQUE"

until $CMD &>> run.log; do
    # print date
    echo $(date +%Y-%m-%d_%H-%M-%S)
    echo "Server 'node src' crashed with exit code $?.  Respawning.." >&2
    sleep 10
done
