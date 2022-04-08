#!/bin/bash

set -eu

cd doc/source/examples
sudo -E docker-compose -p zuul-tutorial up -d