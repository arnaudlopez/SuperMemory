ARG HINDSIGHT_BASE_IMAGE=ghcr.io/vectorize-io/hindsight@sha256:6364c3c5f1e551447976d6c3ab369040d0237c0980f10f911d76d981290913b6
FROM ${HINDSIGHT_BASE_IMAGE}

USER root
COPY deploy/hindsight/entrypoint.sh /usr/local/bin/supermemory-hindsight-entrypoint
RUN chmod 0755 /usr/local/bin/supermemory-hindsight-entrypoint
USER hindsight

ENTRYPOINT ["/usr/local/bin/supermemory-hindsight-entrypoint"]
