#!/bin/bash

# Run `node .` , restarting it if it crashes.
# route output to append run.log

# CMD="node src THE-VOID AD-ASTRA ROQUE WHYANDO"
# CMD="node src THE-VOID AD-ASTRA ROQUE"
# CMD="node src WHYANDO JAVASCRPT-GOOD PYTHON-BAD"
CMD="node src/index-explore.js"

until $CMD &>> run.log; do
    # print date
    echo $(date +%Y-%m-%d_%H-%M-%S)
    echo "Server 'node src' crashed with exit code $?.  Respawning.." >&2
    sleep 30
done
