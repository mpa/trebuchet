/**
 * Trebuchet - Let's chuck some email!
 *
 * @author Andrew Sliwinski <andrew@diy.org>
 * @contributor Nick Baugh <niftylettuce@gmail.com>
 */

/**
 * Dependencies
 */
var fs          = require('fs'),
    path        = require('path'),
    _           = require('underscore'),
    async       = require('async'),
    request     = require('request'),
    handlebars  = require('handlebars');

/**
 * Module
 */
module.exports = function (config) {

    // Storage object
    var outbox     = [];
    
    // cache for compiled templates
    var compiledTemplates = {};

    // Configure w/ backwards compatible API key passed as string
    if (_.isString(config)) {
        config = {
            apikey: config
        };
    }

    _.defaults(config, {
        apikey: 'POSTMARK_API_TEST',
        env: 'PRODUCTION',
        templateDirectory: './templates'
    });
    
    handlebars.registerHelper('nl2br', function(text) {
        text = handlebars.Utils.escapeExpression(text);
        var nl2br = (text + '').replace(/([^>\r\n]?)(\r\n|\n\r|\r|\n)/g, '$1' + '<br>' + '$2');
        return new handlebars.SafeString(nl2br);
    });

    // ---------------------------
    // ---------------------------

    /**
     * Fling - sends a single email to a single target
     *
     * @param {Object} - params: Postmark API "params", e.g. from, to, subject
     *                 - html
     *                 - text
     *                 - data
     *
     * @return {Function}
     */
    var fling = function (options, callback) {
        _.defaults(options, {
            params: {},
            html: '',
            text: '',
            data: {},
            templateName: ''
        });

        compile(options.html, options.text, options.data, options.templateName, function (err, content) {
            if (err) return callback(err, content);

            try {
                var message = options.params;
                message.htmlbody = content.html;
                message.textbody = content.text;
                send(message, callback);
            } catch (err) {
                callback(err);
            }
        });
    };

    /**
     * Loads a piece of mail into the outbox.
     *
     * @param {Object} Postmark API params
     *
     * @return {Function}
     */
    var load = function (options, callback) {
        _.defaults(options, {
            params: {},
            html: '',
            text: '',
            data: {},
            templateName: ''
        });

        compile(options.html, options.text, options.data, options.templateName, function (err, content) {
            if (err) return callback(err, content);

            try {
                var message = options.params;
                message.htmlbody = content.html;
                message.textbody = content.text;
                if (outbox.length >= 500) {
                    callback('Postmark API batch size limit has been reached.', outbox.length);
                } else {
                    outbox.push(message);
                    callback(null, outbox.length);
                }
            } catch (err) {
                callback(err);
            }
        });
    };

    /**
    * Fires all of the mail in the outbox.
    *
    * @return {Function}
    */
    var fire = function (callback) {
        send(outbox, function (err, obj) {
            reset(function () {
                callback(err, obj);
            });
        });
    };

    /**
    * Resets (purges) the outbox.
    *
    * @return {Function}
    */
    var reset = function (callback) {
        outbox = [];
        callback(null, outbox.length);
    };

    /**
     * Compiles templates and returns rendered result.
     *
     * @param {String} File path
     * @param {String} File path
     * @param {String} File path
     * @param {Object} Template locals
     * @param {String} Template directory
     * 
     * @return {Function}
     */
    var compile = function (html, text, data, templateName, callback) {
        // Check if we're going to use a template
        if (templateName !== '') {
            html = path.join(config.templateDirectory, templateName, 'index.html');
            text = path.join(config.templateDirectory, templateName, 'index.txt');
        }
        
        // Processor
        var proc = function (input, data, callback) {
            var abspath = path.resolve(input),
                buffer  = '',
                compiledTemplate,
                result,
                msg;
            
            compiledTemplate = compiledTemplates[abspath];
            
            function proceed(data, callback) {
                result = compiledTemplate(data);
                callback(false, result);
            };
            
            if(!compiledTemplate)
            {
                fs.readFile(abspath, 'utf-8', function(err, template){
                    if (err) {
                        return callback(err, template);
                    }

                    try {
                        compiledTemplate = compiledTemplates[abspath] = handlebars.compile(template);
                        proceed(data, callback);
                    }
                    catch(e)
                    {
                        msg = 'Caught an exception while processing file: ' + abspath + '\n';
                        msg += e.toString()
                        callback(true, msg);
                    }
                });
            }
            else
            {
                proceed(data, callback);
            }
        };

        // Compile & return HTML and text inputs
        async.parallel({
            html: function (callback) { proc(html, data, callback); },
            text: function (callback) { proc(text, data, callback); }
        }, function(err, res){
            callback(err,res);
        });
    };

    /**
     * Sends a request to the Postmark API.
     *
     * @param {Object} Message
     *
     * @param {Function}
     */
    var send = function (message, callback) {
        var url = {
            batch: 'https://api.postmarkapp.com/email/batch',
            email: 'https://api.postmarkapp.com/email'
        };

        var uri = (_.isArray(message)) ? url.batch : url.email;

        request({
            uri:        uri,
            method:     'POST',
            headers:    { 'X-Postmark-Server-Token': config.apikey },
            json:       message
        }, function (e, r, body) {
            if (e) {
                callback(e);
            } else if (r.statusCode !== 200) {
                callback(body.Message);
            } else {
                callback(null, body);
            }
        });
    };

    // ---------------------------
    // ---------------------------
  
    return {
        fling: fling,
        load: load,
        fire: fire,
        reset: reset
    };

};