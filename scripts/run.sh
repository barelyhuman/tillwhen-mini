#!/bin/bash
set -e

# Set the directory of the database in a variable
DB_PATH=/data/prod.sqlite3

# Restore the database if it does not already exist.
if [ -f $DB_PATH ]; then
	echo "Database already exists, skipping restore"
else
	echo "No database found, restoring from replica if exists"
	# litestream restore --if-replica-exists $DB_PATH
fi

pnpx prisma migrate deploy

# Run litestream with your app as the subprocess.
exec node dist/server.mjs