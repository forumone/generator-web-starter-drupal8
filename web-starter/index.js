'use strict';

var generators = require('yeoman-generator');
var _ = require('lodash');
var Promise = require('bluebird');
var glob = Promise.promisify(require('glob'));
var pkg = require('../package.json');
var ygp = require('yeoman-generator-bluebird');
var drupalModules = require('drupal-modules');

module.exports = generators.Base.extend({
  initializing: {
    async: function () {
      ygp(this);
      this.options.addDevDependency(pkg.name, '~' + pkg.version);
    },
    platform: function () {
      // Set the platform
      this.options.parent.answers.platform = 'drupal8';
    },
  },
  prompting: function () {
    var that = this;

    var config = _.extend({
      drupal_version: '',
      composer: true,
      features: true,
      drupal_theme: 'gesso',
    }, this.config.getAll());

    return drupalModules.getLatestMinorVersions('drupal').then(function (releases) {
      var tags = _.chain(releases)
        .filter({ version_major: 8 })
        .map(function (release) {
          return release.version;
        })
        .value();

      if (config.drupal_version && String(tags[0]) !== String(config.drupal_version)) {
        tags.push(config.drupal_version);
      }

      return Promise.resolve(tags);
    })
    .then(function (tags) {
      return that.prompt([{
        type: 'confirm',
        name: 'composer',
        message: 'Use Composer to manage PHP dependencies?',
        default: config.composer,
      },
      {
        type: 'list',
        name: 'drupal_version',
        choices: tags,
        message: 'Select a version of Drupal',
        default: config.drupal_version,
      },
      {
        type: 'confirm',
        name: 'features',
        message: 'Does it use the Features module?',
        default: config.features,
      },
      {
        type: 'input',
        name: 'drupal_theme',
        message: 'Theme name (machine name)',
        default: config.drupal_theme,
        validate: function (value) {
          return value !== '';
        },
      },
      {
        type: 'confirm',
        name: 'install_drupal',
        message: 'Install a fresh copy of Drupal?',
        default: false,
      }]);
    })
    .then(function (answers) {
      that.config.set(answers);

      // Expose the answers on the parent generator
      _.extend(that.options.parent.answers, { 'web-starter-drupal8': answers });
    });
  },
  configuring: {
    addCapistrano: function () {
      var config = this.config.getAll();
      var docRoot = this.options.hasService('web') ? this.options.getService('web').doc_root : 'public';

      // If we're using Capistrano set some additional values
      if (_.has(this.options.parent.answers, 'web-starter-capistrano')) {
        _.extend(this.options.parent.answers['web-starter-capistrano'].config, {
          drupal_features: config.features,
          drupal_db_updates: 'true',
          linked_dirs: '%w[' + docRoot + '/sites/default/files]',
        });
      }
    },
    setThemePath: function () {
      var docRoot = this.options.hasService('web') ? this.options.getService('web').doc_root : 'public';

      this.options.parent.answers.theme_path = docRoot + '/themes/' + this.options.parent.answers['web-starter-drupal8'].drupal_theme;
      this.options.parent.answers.build_path = docRoot + '/themes/' + this.options.parent.answers['web-starter-drupal8'].drupal_theme;
    },
  },
  writing: {
    drupal: function () {
      var that = this;
      var config = this.config.getAll();
      var docRoot = this.options.hasService('web') ? this.options.getService('web').doc_root : 'public';

      if (config.install_drupal) {
        // Create a Promise for remote downloading
        return this.remoteAsync('drupal', 'drupal', config.drupal_version)
        .bind({})
        .then(function (remote) {
          this.remotePath = remote.cachePath;
          return glob('**', { cwd: remote.cachePath });
        })
        .then(function (files) {
          var remotePath = this.remotePath;
          _.each(files, function (file) {
            that.fs.copy(
              remotePath + '/' + file,
              that.destinationPath(docRoot + '/' + file)
            );
          });
        });
      }

      return Promise.resolve();
    },
    settings: function () {
      // Get current system config for this sub-generator
      var config = this.options.parent.answers['web-starter-drupal8'];
      _.extend(config, this.options.parent.answers);
      config.services = this.options.getServices();
      var docRoot = this.options.hasService('web') ? this.options.getService('web').doc_root : 'public';
      var that = this;

      glob('**', {
        cwd: this.templatePath('public'),
        dot: true,
        nodir: true,
      }).then(function (files) {
        _.each(files, function (file) {
          that.fs.copyTpl(that.templatePath('public/' + file), that.destinationPath(docRoot + '/' + file), config);
        });
      });

      // Move old Drush files to the proper directory
      glob('**', {
        cwd: this.destinationPath(docRoot + '/sites/all/drush'),
        dot: true,
        nodir: true,
      })
      .then(function (files) {
        _.each(files, function (file) {
          that.fs.move(that.destinationPath(docRoot + '/sites/all/drush/' + file), that.destinationPath('drush/' + file));
        });
      })
      // Copy new Drush files
      .then(glob('**', {
        cwd: this.templatePath('drush'),
        dot: true,
        nodir: true,
        ignore: [
          '**/aliases.drushrc.php',
        ],
      }))
      .then(function (files) {
        _.each(files, function (file) {
          that.fs.copyTpl(that.templatePath('drush/' + file), that.destinationPath('drush/' + file));
        });
      })
      .then(function () {
        var aliasFile = config.name + '.aliases.drushrc.php';
        // Don't recreate the alias file if it already exists
        if (!that.fs.exists('drush/' + aliasFile)) {
          that.fs.copyTpl(
            that.templatePath('drush/aliases.drushrc.php'),
            that.destinationPath('drush/' + aliasFile),
            config
          );
        }
      });

      glob('**', {
        cwd: this.templatePath(),
        dot: true,
        nodir: true,
        ignore: [
          'public/',
          'drush/',
          '**/aliases.drushrc.php',
        ],
      }).then(function (files) {
        _.each(files, function (file) {
          that.fs.copyTpl(that.templatePath(file), that.destinationPath(file), config);
        });
      });
    },
  },
});
