/**
 *
 * (c) Copyright Ascensio System SIA 2021
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

const reqConsts = require('./request');
const docManager = require("../docManager");
const fileUtility = require("../fileUtility");
const lockManager = require("./lockManager");
const utils = require("./utils");
const fileSystem = require("fs");
const mime = require("mime");
const path = require("path");
const users = require("../users");

const actionMapping = {};
actionMapping[reqConsts.requestType.GetFile] = getFile;
actionMapping[reqConsts.requestType.PutFile] = putFile;
actionMapping[reqConsts.requestType.CheckFileInfo] = checkFileInfo;
actionMapping[reqConsts.requestType.UnlockAndRelock] = unlockAndRelock;
actionMapping[reqConsts.requestType.Lock] = lock;
actionMapping[reqConsts.requestType.GetLock] = getLock;
actionMapping[reqConsts.requestType.RefreshLock] = refreshLock;
actionMapping[reqConsts.requestType.Unlock] = unlock;

// parse wopi request
function parseWopiRequest(req) {
    let wopiData = {
        requestType: reqConsts.requestType.None,
        accessToken: req.query["access_token"],
        id: req.params['id']
    }

    // get the request path
    let reqPath = req.path.substring("/wopi/".length)

    if (reqPath.startsWith("files")) {  // if it starts with "files"
        if (reqPath.endsWith("/contents")) {  // ends with "/contents"
            if (req.method == "GET") {  // and the request method is GET
                wopiData.requestType = reqConsts.requestType.GetFile;  // then the request type is GetFile
            } else if (req.method == "POST") {  // if the request method is POST
                wopiData.requestType = reqConsts.requestType.PutFile;  // then the request type is PutFile
            }
        } else {
            if (req.method == "GET") {  // otherwise, if the request method is GET
                wopiData.requestType = reqConsts.requestType.CheckFileInfo;  // the request type is CheckFileInfo
            } else if (req.method == "POST") {  // if the request method is POST
                let wopiOverride = req.headers[reqConsts.requestHeaders.RequestType.toLowerCase()];  // get the X-WOPI-Override header which determines the request type
                switch (wopiOverride) {
                    case "LOCK":  // if it is equal to LOCK
                        if (req.headers[reqConsts.requestHeaders.OldLock.toLowerCase()]) {  // check if the request sends the X-WOPI-OldLock header
                            wopiData.requestType = reqConsts.requestType.UnlockAndRelock;  // if yes, then the request type is UnlockAndRelock
                        } else {
                            wopiData.requestType = reqConsts.requestType.Lock;  // otherwise, it is Lock
                        }
                        break;

                    case "GET_LOCK":  // if it is equal to GET_LOCK
                        wopiData.requestType = reqConsts.requestType.GetLock;  // the request type is GetLock
                        break;

                    case "REFRESH_LOCK":  // if it is equal to REFRESH_LOCK
                        wopiData.requestType = reqConsts.requestType.RefreshLock;  // the request type is RefreshLock
                        break;

                    case "UNLOCK":  // if it is equal to UNLOCK
                        wopiData.requestType = reqConsts.requestType.Unlock;  // the request type is Unlock
                        break;

                    case "PUT_RELATIVE":  // if it is equal to PUT_RELATIVE
                        wopiData.requestType = reqConsts.requestType.PutRelativeFile;  // the request type is PutRelativeFile (creates a new file on the host based on the current file)
                        break;

                    case "RENAME_FILE":  // if it is equal to RENAME_FILE
                        wopiData.requestType = reqConsts.requestType.RenameFile;  // the request type is RenameFile (renames a file)
                        break;

                    case "PUT_USER_INFO":  // if it is equal to PUT_USER_INFO
                        wopiData.requestType = reqConsts.requestType.PutUserInfo;  // the request type is PutUserInfo (stores some basic user information on the host)
                        break;
                }
            }
        }
    } else if (reqPath.startsWith("folders")) {

    }

    return wopiData;
}

// lock file editing
function lock(wopi, req, res, userHost) {
    let requestLock = req.headers[reqConsts.requestHeaders.Lock.toLowerCase()];

    let userAddress = docManager.curUserHostAddress(userHost);  // get current user host address
    let filePath = docManager.storagePath(wopi.id, userAddress);  // get the storage path of the given file

    if (!lockManager.hasLock(filePath)) {
        // file isn't locked => lock
        lockManager.lock(filePath, requestLock);
        res.sendStatus(200);
    } else if (lockManager.getLock(filePath) == requestLock) {
        // lock matches current lock => extend duration
        lockManager.lock(filePath, requestLock);
        res.sendStatus(200);
    } else {
        // file locked by someone else => return lock mismatch
        let lock = lockManager.getLock(filePath);
        returnLockMismatch(res, lock, "File already locked by " + lock)
    }
}

// retrieve a lock on a file
function getLock(wopi, req, res, userHost) {
    let userAddress = docManager.curUserHostAddress(userHost);
    let filePath = docManager.storagePath(wopi.id, userAddress);

    // get the lock of the specified file and set it as the X-WOPI-Lock header
    res.setHeader(reqConsts.requestHeaders.lock, lockManager.getLock(filePath));
    res.sendStatus(200);
}

// refresh the lock on a file by resetting its automatic expiration timer to 30 minutes
function refreshLock(wopi, req, res, userHost) {
    let requestLock = req.headers[reqConsts.requestHeaders.Lock.toLowerCase()];

    let userAddress = docManager.curUserHostAddress(userHost);
    let filePath = docManager.storagePath(wopi.id, userAddress);

    if (!lockManager.hasLock(filePath)) {
        // file isn't locked => mismatch
        returnLockMismatch(res, "", "File isn't locked");
    } else if (lockManager.getLock(filePath) == requestLock) {
        // lock matches current lock => extend duration
        lockManager.lock(filePath, requestLock);
        res.sendStatus(200);
    } else {
        // lock mismatch
        returnLockMismatch(res, lockManager.getLock(filePath), "Lock mismatch");
    }
}

// allow for file editing
function unlock(wopi, req, res, userHost) {
    let requestLock = req.headers[reqConsts.requestHeaders.Lock.toLowerCase()];

    let userAddress = docManager.curUserHostAddress(userHost);
    let filePath = docManager.storagePath(wopi.id, userAddress);

    if (!lockManager.hasLock(filePath)) {
        // file isn't locked => mismatch
        returnLockMismatch(res, "", "File isn't locked");
    } else if (lockManager.getLock(filePath) == requestLock) {
        // lock matches current lock => unlock
        lockManager.unlock(filePath);
        res.sendStatus(200);
    } else {
        // lock mismatch
        returnLockMismatch(res, lockManager.getLock(filePath), "Lock mismatch");
    }
}

// allow for file editing, and then immediately take a new lock on the file
function unlockAndRelock(wopi, req, res, userHost) {
    let requestLock = req.headers[reqConsts.requestHeaders.Lock.toLowerCase()];
    let oldLock = req.headers[reqConsts.requestHeaders.oldLock.toLowerCase()];  // get the X-WOPI-OldLock header

    let userAddress = docManager.curUserHostAddress(userHost);
    let filePath = docManager.storagePath(wopi.id, userAddress);

    if (!lockManager.hasLock(filePath)) {
        // file isn't locked => mismatch
        returnLockMismatch(res, "", "File isn't locked");
    } else if (lockManager.getLock(filePath) == oldLock) {
        // lock matches current lock => lock with new key
        lockManager.lock(filePath, requestLock);
        res.sendStatus(200);
    } else {
        // lock mismatch
        returnLockMismatch(res, lockManager.getLock(filePath), "Lock mismatch");
    }
}

// request a message to retrieve a file
function getFile(wopi, req, res, userHost) {
    let userAddress = docManager.curUserHostAddress(userHost);

    let path = docManager.storagePath(wopi.id, userAddress);

    res.setHeader("Content-Length", fileSystem.statSync(path).size);
    res.setHeader("Content-Type", mime.getType(path));

    res.setHeader("Content-Disposition", "attachment; filename*=UTF-8\'\'" + encodeURIComponent(wopi.id));

    let filestream = fileSystem.createReadStream(path);  // open a file as a readable stream
    filestream.pipe(res);  // retrieve data from file stream and output it to the response object
}

// request a message to update a file
function putFile(wopi, req, res, userHost) {
    let requestLock = req.headers[reqConsts.requestHeaders.Lock.toLowerCase()];

    let userAddress = docManager.curUserHostAddress(userHost);
    let storagePath = docManager.storagePath(wopi.id, userAddress);

    if (!lockManager.hasLock(storagePath)) {
        // ToDo: if body length is 0 bytes => handle document creation

        // file isn't locked => mismatch
        returnLockMismatch(res, "", "File isn't locked");
    } else if (lockManager.getLock(storagePath) == requestLock) {
        // lock matches current lock => put file
        if (req.body) {
            var historyPath = docManager.historyPath(wopi.id, userAddress);  // get the path to the file history
            if (historyPath == "") {  // if it is empty
                historyPath = docManager.historyPath(wopi.id, userAddress, true);  // create it
                docManager.createDirectory(historyPath);  // and create a new directory for the history
            }

            var count_version = docManager.countVersion(historyPath);  // get the last file version
            version = count_version + 1;  // get a number of a new file version
            res.setHeader(reqConsts.requestHeaders.ItemVersion, version + 1);  // set the X-WOPI-ItemVersion header
            var versionPath = docManager.versionPath(wopi.id, userAddress, version);  // get the path to the specified file version
            docManager.createDirectory(versionPath);  // and create a new directory for the specified version

            var path_prev = path.join(versionPath, "prev" + fileUtility.getFileExtension(wopi.id));  // get the path to the previous file version
            fileSystem.renameSync(docManager.storagePath(wopi.id, userAddress), path_prev);  // synchronously rename the given file as the previous file version

            let filestream = fileSystem.createWriteStream(storagePath);
            req.pipe(filestream);
            req.on('end', () => {
                filestream.close();
                res.sendStatus(200);
            })
        } else {
            res.sendStatus(404);
        }
    } else {
        // lock mismatch
        returnLockMismatch(res, lockManager.getLock(storagePath), "Lock mismatch");
    }
}

// return information about the file properties, access rights and editor settings
function checkFileInfo(wopi, req, res, userHost) {
    let userAddress = docManager.curUserHostAddress(userHost);
    let historyPath = docManager.historyPath(wopi.id, userAddress);  // get the path to the file history
    let version = 1;
    if (historyPath != "") {  // if it isn't empty
        version = docManager.countVersion(historyPath) + 1;  // get a number of a new file version
    }
    let path = docManager.storagePath(wopi.id, userAddress);

    let user = users.getUser(req.query.userid);

    // create the file information object
    let fileInfo = {
        "BaseFileName": wopi.id,
        "OwnerId": docManager.getFileData(wopi.id, userAddress)[1],
        "Size": fileSystem.statSync(path).size,
        "UserId": user.id,
        "UserFriendlyName": user.name,
        "Version": version,
        "UserCanWrite": true,
        "SupportsGetLock": true,
        "SupportsLocks": true,
        "SupportsUpdate": true,
    };
    res.status(200).send(fileInfo);
}

// return lock mismatch
function returnLockMismatch(res, lock, reason) {
    res.setHeader(reqConsts.requestHeaders.Lock, lock || "");  // set the X-WOPI-Lock header
    if (reason) {  // if there is a reason for lock mismatch
        res.setHeader(reqConsts.requestHeaders.LockFailureReason, reason);  // set it as the X-WOPI-LockFailureReason header
    }
    res.sendStatus(409); // conflict
}

exports.fileRequestHandler = (req, res) => {
    let userAddress = null;
    if (req.params['id'].includes("@")) {  // if there is the "@" sign in the id parameter
        let split = req.params['id'].split("@");  // split this parameter by "@"
        req.params['id'] = split[0];  // rewrite id with the first part of the split parameter
        userAddress = split[1];  // save the second part as the user address
    }

    let wopiData = parseWopiRequest(req);  // get the wopi data

    // an error of the unknown request type
    if (wopiData.requestType == reqConsts.requestType.None) {
        res.status(500).send({ 'title': 'fileHandler', 'method': req.method, 'id': req.params['id'], 'error': "unknown" });
        return;
    }

    // an error of the unsupported request type
    let action = actionMapping[wopiData.requestType];
    if (!action) {
        res.status(501).send({ 'title': 'fileHandler', 'method': req.method, 'id': req.params['id'], 'error': "unsupported" });
        return;
    }

    action(wopiData, req, res);
}