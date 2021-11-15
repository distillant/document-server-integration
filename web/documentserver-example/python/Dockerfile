FROM python:3.9-slim-buster

RUN apt-get -y update
RUN apt-get -y install libmagic-dev

ENV LANG=en_US.UTF-8 \
    LANGUAGE=en_US:en \
    LC_ALL=en_US.UTF-8

WORKDIR /var/www/onlyoffice/documentserver-example/
COPY . /var/www/onlyoffice/documentserver-example/

RUN groupadd --system --gid 1001 ds && \
    useradd --system -g ds --no-create-home --shell /sbin/nologin --uid 1001 ds && \
    chown -R ds:ds /var/www/onlyoffice/documentserver-example/ && \
    mkdir -p /var/lib/onlyoffice/documentserver-example/ && \
    chown -R ds:ds /var/lib/onlyoffice/ && \
   # mv files /var/lib/onlyoffice/documentserver-example/ && \
    mkdir -p /etc/onlyoffice/documentserver-example/ && \
    chown -R ds:ds /etc/onlyoffice/ && \
  #  mv config/* /etc/onlyoffice/documentserver-example/ && \
    pip install -r requirements.txt



RUN mkdir /var/www/onlyoffice/documentserver-example/files

EXPOSE 3000

USER ds

EXPOSE 4000:4000
CMD python manage.py runserver 0.0.0.0:4000

