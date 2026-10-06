/**
 * backup.ts
 *
 * Backup and disaster recovery system for AgentShield.
 * Handles database backups, configuration snapshots, and recovery procedures.
 */

import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from './logger';

const execAsync = promisify(exec);
const CTX = 'Backup';

export interface BackupMetadata {
  id: string;
  timestamp: string;
  type: 'full' | 'incremental' | 'config';
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  size: number;
  duration: number;
  itemsBackedUp: number;
  checksumSHA256?: string;
  encryptionKey?: string;
  notes?: string;
}

export interface BackupLocation {
  type: 'local' | 's3' | 'gcs' | 'azure';
  path: string;
  credentials?: Record<string, string>;
}

class BackupManager {
  private backupDir: string;
  private backupMetadata: Map<string, BackupMetadata> = new Map();
  private isBackupRunning = false;

  constructor(backupDirectory: string = './backups') {
    this.backupDir = backupDirectory;
    this.ensureBackupDirExists();
    this.loadBackupMetadata();
  }

  /**
   * Ensure backup directory exists
   */
  private ensureBackupDirExists(): void {
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
      logger.info(CTX, `Created backup directory: ${this.backupDir}`);
    }
  }

  /**
   * Load backup metadata from disk
   */
  private loadBackupMetadata(): void {
    try {
      const metadataFile = path.join(this.backupDir, 'backups.json');
      if (fs.existsSync(metadataFile)) {
        const data = JSON.parse(fs.readFileSync(metadataFile, 'utf-8'));
        this.backupMetadata = new Map(Object.entries(data));
      }
    } catch (error) {
      logger.warn(CTX, `Failed to load backup metadata: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Save backup metadata to disk
   */
  private saveBackupMetadata(): void {
    try {
      const metadataFile = path.join(this.backupDir, 'backups.json');
      const data = Object.fromEntries(this.backupMetadata);
      fs.writeFileSync(metadataFile, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.error(CTX, `Failed to save backup metadata: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Create a full database backup
   */
  async createFullBackup(databasePath: string): Promise<BackupMetadata> {
    if (this.isBackupRunning) {
      throw new Error('Backup already in progress');
    }

    this.isBackupRunning = true;
    const backupId = `full-${Date.now()}`;
    const startTime = Date.now();

    const metadata: BackupMetadata = {
      id: backupId,
      timestamp: new Date().toISOString(),
      type: 'full',
      status: 'in_progress',
      size: 0,
      duration: 0,
      itemsBackedUp: 0,
    };

    try {
      logger.info(CTX, `Starting full backup: ${backupId}`);

      // Create backup directory
      const backupPath = path.join(this.backupDir, backupId);
      fs.mkdirSync(backupPath, { recursive: true });

      // Backup database
      if (fs.existsSync(databasePath)) {
        const dbBackupPath = path.join(backupPath, 'agentshield.db');
        fs.copyFileSync(databasePath, dbBackupPath);
        metadata.itemsBackedUp++;
        logger.info(CTX, `Backed up database to ${dbBackupPath}`);
      }

      // Backup configuration
      const configPath = 'backend/agentshield.config.yaml';
      if (fs.existsSync(configPath)) {
        const configBackupPath = path.join(backupPath, 'agentshield.config.yaml');
        fs.copyFileSync(configPath, configBackupPath);
        metadata.itemsBackedUp++;
        logger.info(CTX, `Backed up configuration`);
      }

      // Calculate backup size
      metadata.size = this.calculateDirSize(backupPath);
      metadata.duration = Date.now() - startTime;
      metadata.status = 'completed';

      this.backupMetadata.set(backupId, metadata);
      this.saveBackupMetadata();

      logger.info(
        CTX,
        `Full backup completed: ${backupId} (${(metadata.size / 1024 / 1024).toFixed(2)}MB, ${metadata.duration}ms)`
      );

      return metadata;
    } catch (error) {
      metadata.status = 'failed';
      metadata.duration = Date.now() - startTime;
      logger.error(CTX, `Full backup failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    } finally {
      this.isBackupRunning = false;
    }
  }

  /**
   * Create an incremental backup
   */
  async createIncrementalBackup(databasePath: string, lastBackupId?: string): Promise<BackupMetadata> {
    if (this.isBackupRunning) {
      throw new Error('Backup already in progress');
    }

    this.isBackupRunning = true;
    const backupId = `incremental-${Date.now()}`;
    const startTime = Date.now();

    const metadata: BackupMetadata = {
      id: backupId,
      timestamp: new Date().toISOString(),
      type: 'incremental',
      status: 'in_progress',
      size: 0,
      duration: 0,
      itemsBackedUp: 0,
    };

    try {
      logger.info(CTX, `Starting incremental backup: ${backupId}`);

      const backupPath = path.join(this.backupDir, backupId);
      fs.mkdirSync(backupPath, { recursive: true });

      // For incremental, we could use database WAL files or file diffs
      // This is a simplified version that just backs up modified files
      if (fs.existsSync(databasePath)) {
        const dbBackupPath = path.join(backupPath, 'agentshield.db');
        fs.copyFileSync(databasePath, dbBackupPath);
        metadata.itemsBackedUp++;
      }

      metadata.size = this.calculateDirSize(backupPath);
      metadata.duration = Date.now() - startTime;
      metadata.status = 'completed';

      this.backupMetadata.set(backupId, metadata);
      this.saveBackupMetadata();

      logger.info(CTX, `Incremental backup completed: ${backupId}`);
      return metadata;
    } catch (error) {
      metadata.status = 'failed';
      metadata.duration = Date.now() - startTime;
      logger.error(CTX, `Incremental backup failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    } finally {
      this.isBackupRunning = false;
    }
  }

  /**
   * Restore from backup
   */
  async restoreFromBackup(backupId: string, databasePath: string): Promise<void> {
    try {
      logger.info(CTX, `Starting restore from backup: ${backupId}`);

      const backupPath = path.join(this.backupDir, backupId);
      if (!fs.existsSync(backupPath)) {
        throw new Error(`Backup not found: ${backupId}`);
      }

      // Backup current database first
      const currentBackupPath = path.join(this.backupDir, `pre-restore-${Date.now()}`);
      fs.mkdirSync(currentBackupPath, { recursive: true });
      if (fs.existsSync(databasePath)) {
        fs.copyFileSync(databasePath, path.join(currentBackupPath, 'agentshield.db'));
      }

      // Restore database
      const dbBackupFile = path.join(backupPath, 'agentshield.db');
      if (fs.existsSync(dbBackupFile)) {
        fs.copyFileSync(dbBackupFile, databasePath);
        logger.info(CTX, `Database restored from ${backupId}`);
      }

      logger.info(CTX, `Restore completed from ${backupId}`);
    } catch (error) {
      logger.error(CTX, `Restore failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * List available backups
   */
  listBackups(type?: 'full' | 'incremental' | 'config'): BackupMetadata[] {
    const backups = Array.from(this.backupMetadata.values());

    if (type) {
      return backups.filter((b) => b.type === type);
    }

    return backups.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  /**
   * Delete old backups
   */
  deleteOldBackups(retentionDays: number): void {
    const now = Date.now();
    const cutoffTime = now - retentionDays * 24 * 60 * 60 * 1000;

    for (const [backupId, metadata] of this.backupMetadata.entries()) {
      const backupTime = new Date(metadata.timestamp).getTime();

      if (backupTime < cutoffTime) {
        try {
          const backupPath = path.join(this.backupDir, backupId);
          fs.rmSync(backupPath, { recursive: true });
          this.backupMetadata.delete(backupId);
          logger.info(CTX, `Deleted old backup: ${backupId}`);
        } catch (error) {
          logger.warn(CTX, `Failed to delete backup ${backupId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    this.saveBackupMetadata();
  }

  /**
   * Calculate directory size
   */
  private calculateDirSize(dirPath: string): number {
    let size = 0;

    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const stat = fs.statSync(filePath);

      if (stat.isDirectory()) {
        size += this.calculateDirSize(filePath);
      } else {
        size += stat.size;
      }
    }

    return size;
  }

  /**
   * Get backup statistics
   */
  getBackupStats(): Record<string, any> {
    const backups = this.listBackups();
    const totalSize = backups.reduce((sum, b) => sum + b.size, 0);

    return {
      total_backups: backups.length,
      total_size: totalSize,
      total_size_mb: (totalSize / 1024 / 1024).toFixed(2),
      by_type: {
        full: backups.filter((b) => b.type === 'full').length,
        incremental: backups.filter((b) => b.type === 'incremental').length,
        config: backups.filter((b) => b.type === 'config').length,
      },
      last_backup: backups[0]?.timestamp,
      oldest_backup: backups[backups.length - 1]?.timestamp,
    };
  }
}

export const backupManager = new BackupManager();

/**
 * Schedule automatic backups
 */
export function scheduleBackups(
  databasePath: string,
  intervalMinutes: number = 60,
  retentionDays: number = 30
): void {
  // Full backup daily
  setInterval(() => {
    backupManager
      .createFullBackup(databasePath)
      .catch((error) => logger.error(CTX, `Scheduled backup failed: ${error instanceof Error ? error.message : String(error)}`));
  }, 24 * 60 * 60 * 1000);

  // Incremental backups hourly
  setInterval(() => {
    backupManager
      .createIncrementalBackup(databasePath)
      .catch((error) => logger.error(CTX, `Incremental backup failed: ${error instanceof Error ? error.message : String(error)}`));
  }, intervalMinutes * 60 * 1000);

  // Delete old backups weekly
  setInterval(() => {
    backupManager.deleteOldBackups(retentionDays);
  }, 7 * 24 * 60 * 60 * 1000);

  logger.info(CTX, `Backup scheduler initialized: full daily, incremental every ${intervalMinutes}min, retention ${retentionDays} days`);
}
