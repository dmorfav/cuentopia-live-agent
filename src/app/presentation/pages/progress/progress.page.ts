import { Component, signal, inject, OnInit, Input } from '@angular/core';
import { SlicePipe } from '@angular/common';
import {
  IonHeader, IonToolbar, IonTitle, IonContent,
  IonList, IonItem, IonItemSliding, IonItemOptions, IonItemOption,
  IonLabel, IonNote,
  IonCard, IonCardHeader, IonCardTitle, IonCardContent,
  IonButton, IonButtons, IonIcon, IonInput, IonItemDivider, IonSpinner,
  IonRefresher, IonRefresherContent,
  ModalController, RefresherCustomEvent
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { lockClosed, lockOpen, statsChart, book, close, trash } from 'ionicons/icons';
import { SessionPort } from '../../../core/ports/session.port';

interface SessionEntry {
  id: string;
  topic: string;
  storyText: string;
  durationSeconds: number;
  startedAt: Date;
}

// ---------------------------------------------------------------------------
// Modal component — inline, only used by ProgressPage
// ---------------------------------------------------------------------------

@Component({
  selector: 'app-session-detail-modal',
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ topic }}</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="dismiss()">
            <ion-icon slot="icon-only" name="close"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <p class="meta">{{ formattedDate }} · {{ formattedDuration }}</p>
      @if (storyText) {
        <p class="transcript">{{ storyText }}</p>
      } @else {
        <p class="no-transcript">Sin transcripción disponible para esta sesión.</p>
      }
    </ion-content>
  `,
  styles: [`
    .meta {
      font-size: 0.85em;
      color: var(--ion-color-medium);
      margin-bottom: 16px;
    }
    .transcript {
      font-size: 0.95em;
      line-height: 1.7;
      white-space: pre-wrap;
      color: var(--ion-color-dark);
    }
    .no-transcript {
      color: var(--ion-color-medium);
      text-align: center;
      margin-top: 48px;
    }
  `],
  standalone: true,
  imports: [IonHeader, IonToolbar, IonTitle, IonContent, IonButton, IonButtons, IonIcon]
})
export class SessionDetailModal {
  private readonly modalCtrl = inject(ModalController);

  @Input() topic = '';
  @Input() storyText = '';
  @Input() formattedDate = '';
  @Input() formattedDuration = '';

  constructor() {
    addIcons({ close });
  }

  dismiss(): void {
    this.modalCtrl.dismiss();
  }
}

// ---------------------------------------------------------------------------
// Progress page
// ---------------------------------------------------------------------------

const PARENT_PIN = '1234';

@Component({
  selector: 'app-progress',
  template: `
    <ion-header [translucent]="true">
      <ion-toolbar>
        <ion-title>Zona Padres</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content [fullscreen]="true">
      @if (!isUnlocked()) {
        <div class="lock-screen ion-padding">
          <ion-icon name="lock-closed" size="large" color="primary"></ion-icon>
          <h2>Acceso Restringido</h2>
          <p>Introduce tu código de padre para ver el progreso.</p>
          <ion-item lines="none" class="pin-input">
            <ion-input
              type="password"
              placeholder="PIN"
              [value]="pinValue()"
              (ionInput)="pinValue.set($event.detail.value ?? '')"
            ></ion-input>
          </ion-item>
          @if (pinError()) {
            <p style="color: var(--ion-color-danger); margin: 0 0 12px;">PIN incorrecto</p>
          }
          <ion-button expand="block" (click)="unlock()">Desbloquear</ion-button>
        </div>
      } @else {
        <ion-refresher slot="fixed" (ionRefresh)="handleRefresh($event)">
          <ion-refresher-content></ion-refresher-content>
        </ion-refresher>
        <div class="dashboard ion-padding">
          @if (loading()) {
            <div class="ion-text-center ion-padding">
              <ion-spinner name="dots" color="primary"></ion-spinner>
            </div>
          } @else if (sessions().length === 0) {
            <div class="ion-text-center ion-padding">
              <ion-icon name="book" size="large" color="medium"></ion-icon>
              <p>Aún no hay sesiones registradas.</p>
            </div>
          } @else {
            <ion-card (click)="openDetail(sessions()[0])" button="true">
              <ion-card-header>
                <ion-card-title>Última sesión</ion-card-title>
              </ion-card-header>
              <ion-card-content>
                <p><strong>{{ sessions()[0].topic }}</strong></p>
                <p>Duración: {{ formatDuration(sessions()[0].durationSeconds) }} · {{ formatDate(sessions()[0].startedAt) }}</p>
                @if (sessions()[0].storyText) {
                  <p class="preview">{{ sessions()[0].storyText | slice:0:160 }}{{ sessions()[0].storyText.length > 160 ? '…' : '' }}</p>
                }
              </ion-card-content>
            </ion-card>

            <ion-list>
              <ion-item-divider>
                <ion-label>Historial de Cuentos</ion-label>
              </ion-item-divider>
              @for (session of sessions(); track session.id) {
                <ion-item-sliding>
                  <ion-item (click)="openDetail(session)" button="true" detail="true">
                    <ion-icon name="book" slot="start" color="primary"></ion-icon>
                    <ion-label>
                      <h3>{{ session.topic }}</h3>
                      <p>{{ formatDate(session.startedAt) }}</p>
                      @if (session.storyText) {
                        <p class="preview-sm">{{ session.storyText | slice:0:80 }}{{ session.storyText.length > 80 ? '…' : '' }}</p>
                      }
                    </ion-label>
                    <ion-note slot="end">{{ formatDuration(session.durationSeconds) }}</ion-note>
                  </ion-item>
                  <ion-item-options side="end">
                    <ion-item-option color="danger" expandable="true" (click)="deleteSession(session.id)">
                      <ion-icon slot="icon-only" name="trash"></ion-icon>
                    </ion-item-option>
                  </ion-item-options>
                </ion-item-sliding>
              }
            </ion-list>
          }
        </div>
      }
    </ion-content>
  `,
  styles: [`
    .lock-screen {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      text-align: center;
    }
    .pin-input {
      background: #f4f4f4;
      border-radius: 10px;
      margin-bottom: 12px;
      width: 150px;
    }
    .preview {
      margin-top: 8px;
      font-size: 0.82em;
      color: var(--ion-color-medium);
      line-height: 1.4;
    }
    .preview-sm {
      font-size: 0.78em;
      color: var(--ion-color-medium);
      margin-top: 2px;
    }
  `],
  standalone: true,
  imports: [
    SlicePipe,
    IonHeader, IonToolbar, IonTitle, IonContent,
    IonList, IonItem, IonItemSliding, IonItemOptions, IonItemOption,
    IonLabel, IonNote,
    IonCard, IonCardHeader, IonCardTitle, IonCardContent,
    IonButton, IonIcon, IonInput, IonItemDivider, IonSpinner,
    IonRefresher, IonRefresherContent
  ]
})
export class ProgressPage implements OnInit {
  private readonly sessionPort = inject(SessionPort);
  private readonly modalCtrl = inject(ModalController);

  isUnlocked = signal(false);
  pinValue = signal<string>('');
  pinError = signal(false);
  loading = signal(false);
  sessions = signal<SessionEntry[]>([]);

  constructor() {
    addIcons({ lockClosed, lockOpen, statsChart, book, close, trash });
  }

  ngOnInit(): void {
    // no-op: sessions load after unlock
  }

  unlock(): void {
    if (this.pinValue() === PARENT_PIN) {
      this.isUnlocked.set(true);
      this.pinError.set(false);
      this._loadSessions();
    } else {
      this.pinError.set(true);
    }
  }

  async handleRefresh(event: RefresherCustomEvent): Promise<void> {
    await this._loadSessions({ silent: true });
    event.detail.complete();
  }

  async deleteSession(id: string): Promise<void> {
    try {
      await this.sessionPort.delete(id);
      this.sessions.update(prev => prev.filter(s => s.id !== id));
    } catch (err) {
      console.error('Error eliminando sesión:', err);
    }
  }

  async openDetail(session: SessionEntry): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: SessionDetailModal,
      componentProps: {
        topic: session.topic,
        storyText: session.storyText,
        formattedDate: this.formatDate(session.startedAt),
        formattedDuration: this.formatDuration(session.durationSeconds),
      },
    });
    await modal.present();
  }

  formatDuration(seconds: number): string {
    if (!seconds) return '< 1 min';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m} min ${s > 0 ? s + ' s' : ''}`.trim() : `${s} s`;
  }

  formatDate(date: Date): string {
    return date.toLocaleString('es-ES', {
      weekday: 'short', day: 'numeric', month: 'short',
      hour: '2-digit', minute: '2-digit'
    });
  }

  private async _loadSessions(opts: { silent?: boolean } = {}): Promise<void> {
    if (!opts.silent) this.loading.set(true);
    try {
      const records = await this.sessionPort.getRecent(10);
      this.sessions.set(records);
    } catch (err) {
      console.error('Error cargando sesiones:', err);
    } finally {
      if (!opts.silent) this.loading.set(false);
    }
  }
}
