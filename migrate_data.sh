#!/bin/bash

SRC=red1:~/spacetraders1/data
DEST=~/spacetraders1/data
# SRC=~/spacetraders1/data
# DEST=red1:~/spacetraders1/data

scp $SRC/mission/WHYANDO-* $DEST/mission/
scp $SRC/market_shared/X1-YY89* $DEST/market_shared/
scp $SRC/stage_runner/WHYANDO* $DEST/stage_runner/
