"use strict";

const execa = require("execa");
const util = require("util");
const p = require("path");

const singleSlash = /\//g;
/*
 * NT_STATUS_NO_SUCH_FILE - when trying to dir a file in a directory that *does* exist
 * NT_STATUS_OBJECT_NAME_NOT_FOUND - when trying to dir a file in a directory that *does not* exist
 */
const missingFileRegex = /(NT_STATUS_OBJECT_NAME_NOT_FOUND|NT_STATUS_NO_SUCH_FILE)/im;

class SambaClient {
  constructor(options) {
    this.address = options.address;
    this.username = options.username;
    this.password = options.password;
    this.domain = options.domain;
    this.port = options.port;
    // Possible values for protocol version are listed in the Samba man pages:
    // https://www.samba.org/samba/docs/current/man-html/smb.conf.5.html#CLIENTMAXPROTOCOL
    this.maxProtocol = options.maxProtocol;
    this.maskCmd = Boolean(options.maskCmd);
  }

  async getFile(path, destination, workingDir) {
    const fileName = path.replace(singleSlash, "\\");
    const cmdArgs = util.format("%s %s", fileName, destination);
    return await this.execute("get", cmdArgs, workingDir);
  }

  async sendFile(path, destination) {
    const workingDir = p.dirname(path);
    const fileName = p.basename(path).replace(singleSlash, "\\");
    const cmdArgs = util.format(
      "%s %s",
      fileName,
      destination.replace(singleSlash, "\\")
    );
    return await this.execute("put", cmdArgs, workingDir);
  }

  async deleteFile(fileName) {
    return await this.execute("del", fileName, "");
  }

  async listFiles(fileNamePrefix, fileNameSuffix) {
    try {
      const cmdArgs = util.format("%s*%s", fileNamePrefix, fileNameSuffix);
      const allOutput = await this.execute("dir", cmdArgs, "");
      const fileList = [];
      const lines = allOutput.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].toString().trim();
        if (line.startsWith(fileNamePrefix)) {
          const parsed = line.substring(
            0,
            line.indexOf(fileNameSuffix) + fileNameSuffix.length
          );
          fileList.push(parsed);
        }
      }
      return fileList;
    } catch (e) {
      if (e.message.match(missingFileRegex)) {
        return [];
      } else {
        throw e;
      }
    }
  }

  async mkdir(remotePath, cwd) {
    return await this.execute(
      "mkdir",
      '"' + remotePath.replace(singleSlash, "\\") + '"',
      cwd !== null && cwd !== undefined ? cwd : __dirname
    );
  }

  async dir(remotePath, cwd) {
    return await this.execute(
      "dir",
      remotePath.replace(singleSlash, "\\"),
      cwd !== null && cwd !== undefined ? cwd : __dirname
    );
  }

  async fileExists(remotePath, cwd) {
    try {
      await this.dir(remotePath, cwd);
      return true;
    } catch (e) {
      if (e.message.match(missingFileRegex)) {
        return false;
      } else {
        throw e;
      }
    }
  }

  async cwd() {
    const cd = await this.execute("cd", "", "");
    return cd.match(/\s.{2}\s(.+?)/)[1];
  }

  async list(remotePath) {
    const remoteDirList = [];
    const remoteDirContents = await this.dir(remotePath);
    for (const content of remoteDirContents.matchAll(
      /\s*(.+?)\s{6,}(.)\s+([0-9]+)\s{2}(.+)/g
    )) {
      remoteDirList.push({
        name: content[1],
        type: content[2],
        size: parseInt(content[3]),
        modifyTime: new Date(content[4] + "Z"),
      });
    }
    return remoteDirList;
  }

  getSmbClientArgs(fullCmd) {
    const args = [];

    if (this.username) {
      args.push("-U", this.username);
    }

    if (!this.password) {
      args.push("-N");
    }

    args.push("-c", fullCmd, this.address);

    if (this.password) {
      args.push(this.password);
    }

    if (this.domain) {
      args.push("-W");
      args.push(this.domain);
    }

    if (this.maxProtocol) {
      args.push("--max-protocol", this.maxProtocol);
    }

    if (this.port) {
      args.push("-p");
      args.push(this.port);
    }

    return args;
  }

  async execute(smbCommand, smbCommandArgs, workingDir) {
    const fullSmbCommand = util.format("%s %s", smbCommand, smbCommandArgs);
    const args = this.getSmbClientArgs(fullSmbCommand);

    const options = {
      all: true,
      cwd: workingDir || "",
    };

    try {
      const { all } = await execa("smbclient", args, options);
      return all;
    } catch (error) {
      if (this.maskCmd) {
        error.message = error.all;
        error.shortMessage = error.all;
      }
      throw error;
    }
  }

  async getAllShares() {
    try {
      const { stdout } = await execa("smbtree", ["-U", "guest", "-N"], {
        all: true,
      });

      const shares = [];
      for (const line in stdout.split(/\r?\n/)) {
        const words = line.split(/\t/);
        if (words.length > 2 && words[2].match(/^\s*$/) !== null) {
          shares.append(words[2].trim());
        }
      }

      return shares;
    } catch (error) {
      if (this.maskCmd) {
        error.message = error.all;
        error.shortMessage = error.all;
      }
      throw error;
    }
  }
}

module.exports = SambaClient;
