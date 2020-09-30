// Copyright 2018 Red Hat, Inc
//
// Licensed under the Apache License, Version 2.0 (the "License"); you may
// not use this file except in compliance with the License. You may obtain
// a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
// WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
// License for the specific language governing permissions and limitations
// under the License.

import Axios from 'axios'

import * as API from '../api'

export const BUILD_FETCH_REQUEST = 'BUILD_FETCH_REQUEST'
export const BUILD_FETCH_SUCCESS = 'BUILD_FETCH_SUCCESS'
export const BUILD_FETCH_FAIL = 'BUILD_FETCH_FAIL'

export const BUILDSET_FETCH_REQUEST = 'BUILDSET_FETCH_REQUEST'
export const BUILDSET_FETCH_SUCCESS = 'BUILDSET_FETCH_SUCCESS'
export const BUILDSET_FETCH_FAIL =    'BUILDSET_FETCH_FAIL'

export const BUILD_OUTPUT_REQUEST = 'BUILD_OUTPUT_FETCH_REQUEST'
export const BUILD_OUTPUT_SUCCESS = 'BUILD_OUTPUT_FETCH_SUCCESS'
export const BUILD_OUTPUT_FAIL = 'BUILD_OUTPUT_FETCH_FAIL'
export const BUILD_OUTPUT_NOT_AVAILABLE = 'BUILD_OUTPUT_NOT_AVAILABLE'

export const BUILD_MANIFEST_REQUEST = 'BUILD_MANIFEST_FETCH_REQUEST'
export const BUILD_MANIFEST_SUCCESS = 'BUILD_MANIFEST_FETCH_SUCCESS'
export const BUILD_MANIFEST_FAIL = 'BUILD_MANIFEST_FETCH_FAIL'
export const BUILD_MANIFEST_NOT_AVAILBLE = 'BUILD_MANIFEST_NOT_AVAILABLE'

export const requestBuild = () => ({
  type: BUILD_FETCH_REQUEST
})

export const receiveBuild = (buildId, build) => ({
  type: BUILD_FETCH_SUCCESS,
  buildId: buildId,
  build: build,
  receivedAt: Date.now()
})

const failedBuild = (error, url) => {
  error.url = url
  return {
    type: BUILD_FETCH_FAIL,
    error
  }
}

export const requestBuildOutput = () => ({
  type: BUILD_OUTPUT_REQUEST
})

// job-output processing functions
export function renderTree(tenant, build, path, obj, textRenderer, defaultRenderer) {
  const node = {}
  let name = obj.name

  if ('children' in obj && obj.children) {
    node.nodes = obj.children.map(
      n => renderTree(tenant, build, path+obj.name+'/', n,
                     textRenderer, defaultRenderer))
  }
  if (obj.mimetype === 'application/directory') {
    name = obj.name + '/'
  } else {
    node.icon = 'fa fa-file-o'
  }

  let log_url = build.log_url
  if (log_url.endsWith('/')) {
    log_url = log_url.slice(0, -1)
  }
  if (obj.mimetype === 'text/plain') {
    node.text = textRenderer(tenant, build, path, name, log_url, obj)
  } else {
    node.text = defaultRenderer(log_url, path, name, obj)
  }
  return node
}

export function didTaskFail(task) {
  if (task.failed) {
    return true
  }
  if (task.results) {
    for (let result of task.results) {
      if (didTaskFail(result)) {
        return true
      }
    }
  }
  return false
}

export function hasInterestingKeys (obj, keys) {
  return Object.entries(obj).filter(
    ([k, v]) => (keys.includes(k) && v !== '')
  ).length > 0
}

export function findLoopLabel(item) {
  const label = item._ansible_item_label
  return typeof(label) === 'string' ? label : ''
}

export function shouldIncludeKey(key, value, ignore_underscore, included) {
  if (ignore_underscore && key[0] === '_') {
    return false
  }
  if (included) {
    if (!included.includes(key)) {
      return false
    }
    if (value === '') {
      return false
    }
  }
  return true
}

export function makeTaskPath (path) {
  return path.join('/')
}

export function taskPathMatches (ref, test) {
  if (test.length < ref.length)
    return false
  for (let i=0; i < ref.length; i++) {
    if (ref[i] !== test[i])
      return false
  }
  return true
}


export const receiveBuildOutput = (buildId, output) => {
  const hosts = {}
  // Compute stats
  output.forEach(phase => {
    Object.entries(phase.stats).forEach(([host, stats]) => {
      if (!hosts[host]) {
        hosts[host] = stats
        hosts[host].failed = []
      } else {
        hosts[host].changed += stats.changed
        hosts[host].failures += stats.failures
        hosts[host].ok += stats.ok
      }
      if (stats.failures > 0) {
        // Look for failed tasks
        phase.plays.forEach(play => {
          play.tasks.forEach(task => {
            if (task.hosts[host]) {
              if (task.hosts[host].results &&
                  task.hosts[host].results.length > 0) {
                task.hosts[host].results.forEach(result => {
                  if (result.failed) {
                    result.name = task.task.name
                    hosts[host].failed.push(result)
                  }
                })
              } else if (task.hosts[host].rc || task.hosts[host].failed) {
                let result = task.hosts[host]
                result.name = task.task.name
                hosts[host].failed.push(result)
              }
            }
          })
        })
      }
    })
  })

  // Identify all of the hosttasks (and therefore tasks, plays, and
  // playbooks) which have failed.  The errorIds are either task or
  // play uuids, or the phase+index for the playbook.  Since they are
  // different formats, we can store them in the same set without
  // collisions.
  const errorIds = new Set()
  output.forEach(playbook => {
    playbook.plays.forEach(play => {
      play.tasks.forEach(task => {
        Object.entries(task.hosts).forEach(([, host]) => {
          if (didTaskFail(host)) {
            errorIds.add(task.task.id)
            errorIds.add(play.play.id)
            errorIds.add(playbook.phase + playbook.index)
          }
        })
      })
    })
  })

  return {
    type: BUILD_OUTPUT_SUCCESS,
    buildId: buildId,
    hosts: hosts,
    output: output,
    errorIds: errorIds,
    receivedAt: Date.now()
  }
}

const failedBuildOutput = (error, url) => {
  error.url = url
  return {
    type: BUILD_OUTPUT_FAIL,
    error
  }
}

export const requestBuildManifest = () => ({
  type: BUILD_MANIFEST_REQUEST
})

export const receiveBuildManifest = (buildId, manifest) => {
  const index = {}

  const renderNode = (root, object) => {
    const path = root + '/' + object.name

    if ('children' in object && object.children) {
      object.children.map(n => renderNode(path, n))
    } else {
      index[path] = object
    }
  }

  manifest.tree.map(n => renderNode('', n))
  return {
    type: BUILD_MANIFEST_SUCCESS,
    buildId: buildId,
    manifest: {tree: manifest.tree, index: index,
               index_links: manifest.index_links},
    receivedAt: Date.now()
  }
}

const failedBuildManifest = (error, url) => {
  error.url = url
  return {
    type: BUILD_MANIFEST_FAIL,
    error
  }
}

function buildOutputNotAvailable() {
  return { type: BUILD_OUTPUT_NOT_AVAILABLE }
}

function buildManifestNotAvailable() {
  return { type: BUILD_MANIFEST_NOT_AVAILBLE }
}

export function fetchBuild(tenant, buildId, state) {
  return async function (dispatch) {
    // Although it feels a little weird to not do anything in an action creator
    // based on the redux state, we do this in here because the function is
    // called from multiple places and it's easier to check for the build in
    // here than in all the other places before calling this function.
    if (state.build.builds[buildId]) {
      return Promise.resolve()
    }

    dispatch(requestBuild())
    try {
      const response = await API.fetchBuild(tenant.apiPrefix, buildId)
      dispatch(receiveBuild(buildId, response.data))
    } catch (error) {
      dispatch(failedBuild(error, tenant.apiPrefix))
      // Raise the error again, so fetchBuildAllInfo() doesn't call the
      // remaining fetch methods.
      throw error
    }
  }
}

function fetchBuildOutput(buildId, state) {
  return async function (dispatch) {
    // As this function is only called after fetchBuild() we can assume that
    // the build is in the state. Otherwise an error would have been thrown and
    // this function wouldn't be called.
    const build = state.build.builds[buildId]
    if (!build.log_url) {
      // Don't treat a missing log URL as failure as we don't want to show a
      // toast for that. The UI already informs about the missing log URL in
      // multiple places.
      dispatch(buildOutputNotAvailable())
      return Promise.resolve()
    }
    const url = build.log_url.substr(0, build.log_url.lastIndexOf('/') + 1)
    dispatch(requestBuildOutput())
    try {
      const response = await Axios.get(url + 'job-output.json.gz')
      dispatch(receiveBuildOutput(buildId, response.data))
    } catch (error) {
      if (!error.request) {
        dispatch(failedBuildOutput(error, url))
        // Raise the error again, so fetchBuildAllInfo() doesn't call the
        // remaining fetch methods.
        throw error
      }
      try {
        // Try without compression
        const response = await Axios.get(url + 'job-output.json')
        dispatch(receiveBuildOutput(buildId, response.data))
      } catch (error) {
        dispatch(failedBuildOutput(error, url))
        // Raise the error again, so fetchBuildAllInfo() doesn't call the
        // remaining fetch methods.
        throw error
      }
    }
  }
}

export const fetchBuildManifest = (buildId, state) => (dispatch) => {
  // As this function is only called after fetchBuild() we can assume that
  // the build is in the state. Otherwise an error would have been thrown and
  // this function wouldn't be called.
  const build = state.build.builds[buildId]
  dispatch(requestBuildManifest())
  for (let artifact of build.artifacts) {
    if ('metadata' in artifact &&
        'type' in artifact.metadata &&
        artifact.metadata.type === 'zuul_manifest') {
      return Axios.get(artifact.url)
        .then(manifest => {
          dispatch(receiveBuildManifest(buildId, manifest.data))
        })
        .catch(error => dispatch(failedBuildManifest(error, artifact.url)))
    }
  }
  // Don't treat a missing manifest file as failure as we don't want to show a
  // toast for that.
  dispatch(buildManifestNotAvailable())
}

export function fetchBuildAllInfo(tenant, buildId) {
  // This wraps the calls to fetch the build, output and manifest together as
  // this is the common use case we have when loading the build info.
  return async function (dispatch, getState) {
    try {
      // Wait for the build info to be available and provide the current status
      // to the fetchBuildOutput and fetchBuildManifest so they can get the log
      // url from the fetched build.
      await dispatch(fetchBuild(tenant, buildId, getState()))
      dispatch(fetchBuildOutput(buildId, getState()))
      dispatch(fetchBuildManifest(buildId, getState()))
    } catch (error) {
      dispatch(failedBuild(error, tenant.apiPrefix))
    }
  }
}

export const requestBuildset = () => ({
  type: BUILDSET_FETCH_REQUEST
})

export const receiveBuildset = (buildsetId, buildset) => ({
  type: BUILDSET_FETCH_SUCCESS,
  buildsetId: buildsetId,
  buildset: buildset,
  receivedAt: Date.now()
})

const failedBuildset = error => ({
  type: BUILDSET_FETCH_FAIL,
  error
})

export function fetchBuildset(tenant, buildsetId) {
  return async function(dispatch) {
    dispatch(requestBuildset())
    try {
      const response = await API.fetchBuildset(tenant.apiPrefix, buildsetId)
      dispatch(receiveBuildset(buildsetId, response.data))
    } catch (error) {
      dispatch(failedBuildset(error))
    }
  }
}

const shouldFetchBuildset = (buildsetId, state) => {
  const buildset = state.build.buildsets[buildsetId]
  if (!buildset) {
    return true
  }
  if (buildset.isFetching) {
    return false
  }
  return false
}

export const fetchBuildsetIfNeeded = (tenant, buildsetId, force) => (
  dispatch, getState) => {
    if (force || shouldFetchBuildset(buildsetId, getState())) {
      return dispatch(fetchBuildset(tenant, buildsetId))
    }
}
