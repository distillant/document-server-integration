FROM python:3.9-slim-buster

RUN apt-get -y update
RUN apt-get -y install libmagic-dev

ENV LANG=en_US.UTF-8 \
    LANGUAGE=en_US:en \
    LC_ALL=en_US.UTF-8


RUN mkdir -p /var/www/onlyoffice/documentserver-example/
COPY . /var/www/onlyoffice/documentserver-example/
WORKDIR /var/www/onlyoffice/documentserver-example/

#RUN python -m venv .venv && \
#    . .venv/bin/activate && \
RUN pip install -r requirements.txt



EXPOSE 3000



EXPOSE 4000:4000
CMD python manage.py runserver 0.0.0.0:4000

