var util = require('util');
var path = require('path');
var q = require('q');
var junk = require('junk');
var BaseAdapter = require('bitbin/src/base_adapter');

var LocalAdapter = function(config, fs, glob, md5Transposer) {
    BaseAdapter.apply(this, arguments);
    this.uploadPath = config.retrieve().options.uploadPath;
    this.fs = fs;
    this.glob = glob;
    this.md5Transposer = md5Transposer;
};

/**
 * @todo abstract this.
 */
var filterJunk = function(files) {
    return files.filter(junk.not);
};

util.inherits(LocalAdapter, BaseAdapter);

/**
 * Checks all files in the list to ensure they exist and are what is required.
 *
 * The file should be the same path and MD5 hash. If any file does not exist
 * or does not match, it should reject the install.
 *
 * @param array files
 * @return promise
 */
LocalAdapter.prototype.ensureFilesExists = function(files) {
    var uploadPath = this.uploadPath;
    var deferred = q.defer();
    this.md5Transposer.transpose(files.map(function(file) {
        return uploadPath + '/' + file.name;
    }), true)
        .then(function(transposed) {
            var prefixLength = uploadPath.length + 1;
            var diff = transposed.map(function(file) {
                return {
                    name: file.name.substr(prefixLength),
                    hash: file.hash
                };
            }).filter(function(file) {
                return !files.some(function(entry) {
                    return entry.name === file.name && entry.hash === file.hash;
                });
            });
            if (diff.length) {
                var message = 'The following files do not exist or does not match required md5sum: \n';
                message += ' * ' + diff.map(function(file) {
                    return file.name + ' (' + file.hash + ')'; 
                }).join('\n * ');
                deferred.reject(message);
            } else {
                // To make the download step easier, just pass the transposed.
                deferred.resolve(transposed);
            }
        });
    return deferred.promise;
};

/**
 * Download and store to the manifest location all files in the list.
 *
 * @param array files
 * @return promise
 * @todo implement
 */
LocalAdapter.prototype.download = function(files) {
    console.log('NOTE: files not downloaded - Not implemented yet.');
    return files;
};

/**
 * Filter files already existing in the upstream.
 *
 * @param array files
 * @return array
 */
LocalAdapter.prototype.filterExisting = function(files) {
    var uploadPath = this.uploadPath;
    var transposer = function(files) {
        return this.md5Transposer.transpose(files, true);
    }.bind(this);
    return q.nfcall(this.glob, uploadPath + '/**/*', {nodir: true})
        .then(filterJunk)
        .then(transposer)
        .then(function(entries) {
            return files.filter(function(file) {
                return !entries.some(function(entry) {
                    return entry.name.substr(uploadPath.length + 1) === file.name && entry.hash === file.hash;
                });
            });
        });
};

/**
 * Upload files to the configured upload location.
 *
 * @param array files
 * @return promise
 */
LocalAdapter.prototype.upload = function(files) {
    var fs = this.fs;
    var uploadPath = this.uploadPath;
    var removeErrored = function(name, file) {
        return file.name !== name;
    };
    var handleError = function(err) {
        throw new Error(err);
    };
    var promises = [];
    files.forEach(function(file) {
        var filePath = path.normalize(uploadPath + '/' + path.dirname(file.name));
        var promise = q.nfcall(fs.mkdirp, filePath)
            .then(function() {
                var writer = fs.createWriteStream(path.normalize(uploadPath + '/' + file.name));
                var fd = fs.ReadStream(path.normalize(process.cwd() + '/' + file.originalName));
                writer.on('error', handleError);
                fd.on('error', handleError);
                fd.pipe(writer);
            })
            .catch(function(err) {
                files = files.filter(removeErrored.bind(null, file.name));
            });
        promises.push(promise);
    });
    return q.all(promises).then(q.bind(q, files));
};

module.exports = function(container) {
    return new LocalAdapter(
        container.config,
        container.node.fs,
        container.glob,
        container.md5TransposeList
    );
};
