FROM alpine:3.20
RUN apk add --no-cache postgresql16-client rclone openssl gzip curl tzdata bash coreutils jq
COPY backup.sh restore-test.sh run.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/*.sh
ENV RCLONE_CONFIG=/config/rclone/rclone.conf
CMD ["/usr/local/bin/run.sh"]
