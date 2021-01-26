# Copyright 2021 BMW Group
#
# Licensed under the Apache License, Version 2.0 (the "License"); you may
# not use this file except in compliance with the License. You may obtain
# a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
# WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
# License for the specific language governing permissions and limitations
# under the License.

import json
import logging
from urllib.parse import quote_plus

from kazoo.exceptions import BadVersionError, NoNodeError

from zuul.lib.logutil import get_annotated_logger
from zuul.zk import ZooKeeperBase


def holdersFromData(data):
    if not data:
        return []
    return json.loads(data.decode("utf8"))


def holdersToData(holders):
    return json.dumps(holders).encode("utf8")


class SemaphoreHandler(ZooKeeperBase):
    log = logging.getLogger("zuul.zk.SemaphoreHandler")

    semaphore_root = "/zuul/semaphores"

    def __init__(self, client, tenant_name, layout):
        super().__init__(client)
        self.layout = layout
        self.tenant_root = f"{self.semaphore_root}/{tenant_name}"

    def acquire(self, item, job, request_resources):
        if not job.semaphore:
            return True

        log = get_annotated_logger(self.log, item.event)
        if job.semaphore.resources_first and request_resources:
            # We're currently in the resource request phase and want to get the
            # resources before locking. So we don't need to do anything here.
            return True
        else:
            # As a safety net we want to acuire the semaphore at least in the
            # run phase so don't filter this here as re-acuiring the semaphore
            # is not a problem here if it has been already acquired before in
            # the resources phase.
            pass

        semaphore_key = quote_plus(job.semaphore.name)
        semaphore_path = f"{self.tenant_root}/{semaphore_key}"
        semaphore_handle = f"{item.uuid}-{job.name}"

        self.kazoo_client.ensure_path(semaphore_path)
        semaphore_holders, zstat = self.getHolders(semaphore_path)

        if semaphore_handle in semaphore_holders:
            return True

        # semaphore is there, check max
        while len(semaphore_holders) < self._max_count(job.semaphore.name):
            semaphore_holders.append(semaphore_handle)

            try:
                self.kazoo_client.set(semaphore_path,
                                      holdersToData(semaphore_holders),
                                      version=zstat.version)
            except BadVersionError:
                log.debug(
                    "Retrying semaphore %s acquire due to concurrent update",
                    job.semaphore.name)
                semaphore_holders, zstat = self.getHolders(semaphore_path)
                continue

            log.debug("Semaphore %s acquired: job %s, item %s",
                      job.semaphore.name, job.name, item)
            return True

        return False

    def getHolders(self, semaphore_path):
        data, zstat = self.kazoo_client.get(semaphore_path)
        return holdersFromData(data), zstat

    def release(self, item, job):
        if not job.semaphore:
            return

        log = get_annotated_logger(self.log, item.event)
        semaphore_key = quote_plus(job.semaphore.name)
        semaphore_path = f"{self.tenant_root}/{semaphore_key}"
        semaphore_handle = f"{item.uuid}-{job.name}"

        while True:
            try:
                semaphore_holders, zstat = self.getHolders(semaphore_path)
                semaphore_holders.remove(semaphore_handle)
            except (ValueError, NoNodeError):
                log.error("Semaphore can not be released for %s "
                          "because the semaphore is not held", item)
                break

            try:
                self.kazoo_client.set(semaphore_path,
                                      holdersToData(semaphore_holders),
                                      zstat.version)
            except BadVersionError:
                log.debug(
                    "Retrying semaphore %s release due to concurrent update",
                    job.semaphore.name)
                continue

            log.debug("Semaphore %s released: job %s, item %s",
                      job.semaphore.name, job.name, item)
            break

    def semaphoreHolders(self, semaphore_name):
        semaphore_key = quote_plus(semaphore_name)
        semaphore_path = f"{self.tenant_root}/{semaphore_key}"
        try:
            holders, _ = self.getHolders(semaphore_path)
        except NoNodeError:
            holders = []
        return holders

    def _max_count(self, semaphore_name: str) -> int:
        semaphore = self.layout.semaphores.get(semaphore_name)
        return 1 if semaphore is None else semaphore.max
