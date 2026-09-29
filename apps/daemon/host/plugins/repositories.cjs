'use strict';
const path = require('path');
const fs = require('fs');
const { TaskRegistry } = require('../src/registry');
const { TaskRepository } = require('../src/repositories/task-repository');
const { SettingsRepository } = require('../src/repositories/settings-repository');
const { DraftRepository } = require('../src/repositories/draft-repository');
const { RecentPathRepository } = require('../src/repositories/recent-path-repository');
const { SeedStore } = require('../src/repositories/seed-store');
const { OperationRepository } = require('../src/repositories/operation-repository');
const { ScheduleRepository } = require('../src/repositories/schedule-repository');
const { ProxySecretStore } = require('../src/secrets/proxy-secret-store');
const { FtpSecretStore } = require('../src/secrets/ftp-secret-store');
const { SqliteDatabase } = require('../src/repositories/sqlite-database');
const { HistoryRepository } = require('../src/repositories/history-repository');
const { LinkRepository } = require('../src/repositories/link-repository');
const { PrivateSpaceSecretStore } = require('../src/secrets/private-space-secret-store');
const { MediaSecretStore } = require('../src/secrets/media-secret-store');
const { plugin } = require('./shared.cjs');

const repositories = plugin('leifeng-repositories', ['leifengConfig'], (ctx) => {
  const { appConfig, runtimeDir, downloadDir } = ctx.leifengConfig;
  const taskRepository = new TaskRepository({ filePath: appConfig.tasksPath, legacyFilePath: appConfig.legacyRegistryPath });
  taskRepository.load();
  const registry = TaskRegistry.fromRepository(taskRepository);
  registry.load();
  const settingsRepository = new SettingsRepository({ filePath: appConfig.settingsPath, defaults: { downloadDir } });
  settingsRepository.load();
  const ftpSecretStore = new FtpSecretStore({ filePath: appConfig.ftpSecretsPath }); ftpSecretStore.load();
  const proxySecretStore = new ProxySecretStore({ filePath: appConfig.proxySecretsPath }); proxySecretStore.load();
  const scheduleRepository = new ScheduleRepository({ filePath: appConfig.schedulesPath }); scheduleRepository.load();
  const recentPathRepository = new RecentPathRepository({ filePath: appConfig.recentPathsPath }); recentPathRepository.load();
  const draftRepository = new DraftRepository({ filePath: appConfig.draftsPath }); draftRepository.load();
  const operationRepository = new OperationRepository({ filePath: appConfig.operationsPath }); operationRepository.load(); operationRepository.prune();
  const privateSecretStore = new PrivateSpaceSecretStore({ filePath: appConfig.privateSpaceSecretsPath }); privateSecretStore.load();
  const mediaSecretStore = new MediaSecretStore({ filePath: appConfig.mediaSecretPath }); mediaSecretStore.load();
  const dataDatabase = new SqliteDatabase({ filePath: appConfig.dataDbPath, backupDir: path.join(runtimeDir, 'backups') });
  dataDatabase.open();
  try { dataDatabase.backup(); } catch (error) { console.error('[thunderd] data database backup skipped:', error.message); }
  const historyRepository = new HistoryRepository({ db: dataDatabase });
  const linkRepository = new LinkRepository({ db: dataDatabase });
  const seedStore = new SeedStore({ rootDir: appConfig.seedsDir });
  ctx.provide('leifengRepositories', {
    taskRepository, registry, settingsRepository, ftpSecretStore, proxySecretStore,
    scheduleRepository, recentPathRepository, draftRepository, operationRepository,
    privateSecretStore, mediaSecretStore,
    dataDatabase, historyRepository, linkRepository, seedStore,
  });
  return () => {
    try { dataDatabase.backup(); } catch (error) { console.error('[thunderd] final data backup skipped:', error.message); }
    dataDatabase.close();
    settingsRepository.close();
    scheduleRepository.close();
    taskRepository.close();
  };
});

module.exports = { repositories };
