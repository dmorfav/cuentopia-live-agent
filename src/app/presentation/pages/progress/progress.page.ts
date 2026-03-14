import { Component, signal, inject, OnInit } from '@angular/core';
import {
  IonHeader, IonToolbar, IonTitle, IonContent,
  IonList, IonItem, IonLabel, IonNote,
  IonCard, IonCardHeader, IonCardTitle, IonCardContent,
  IonButton, IonIcon, IonInput, IonItemDivider, IonSpinner
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { lockClosed, lockOpen, statsChart, book } from 'ionicons/icons';
import { SessionPort } from '../../../core/ports/session.port';

interface SessionEntry {
  id: string;
  topic: string;
  durationSeconds: number;
  startedAt: Date;
}

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
            <ion-card>
              <ion-card-header>
                <ion-card-title>Última sesión</ion-card-title>
              </ion-card-header>
              <ion-card-content>
                <p><strong>{{ sessions()[0].topic }}</strong></p>
                <p>Duración: {{ formatDuration(sessions()[0].durationSeconds) }}</p>
                <p>{{ formatDate(sessions()[0].startedAt) }}</p>
              </ion-card-content>
            </ion-card>

            <ion-list>
              <ion-item-divider>
                <ion-label>Historial de Cuentos</ion-label>
              </ion-item-divider>
              @for (session of sessions(); track session.id) {
                <ion-item>
                  <ion-icon name="book" slot="start" color="primary"></ion-icon>
                  <ion-label>
                    <h3>{{ session.topic }}</h3>
                    <p>{{ formatDate(session.startedAt) }}</p>
                  </ion-label>
                  <ion-note slot="end">{{ formatDuration(session.durationSeconds) }}</ion-note>
                </ion-item>
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
  `],
  standalone: true,
  imports: [
    IonHeader, IonToolbar, IonTitle, IonContent,
    IonList, IonItem, IonLabel, IonNote,
    IonCard, IonCardHeader, IonCardTitle, IonCardContent,
    IonButton, IonIcon, IonInput, IonItemDivider, IonSpinner
  ]
})
export class ProgressPage implements OnInit {
  private readonly sessionPort = inject(SessionPort);

  isUnlocked = signal(false);
  pinValue = signal<string>('');
  pinError = signal(false);
  loading = signal(false);
  sessions = signal<SessionEntry[]>([]);

  constructor() {
    addIcons({ lockClosed, lockOpen, statsChart, book });
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

  private async _loadSessions(): Promise<void> {
    this.loading.set(true);
    try {
      const records = await this.sessionPort.getRecent(10);
      this.sessions.set(records);
    } catch (err) {
      console.error('Error cargando sesiones:', err);
    } finally {
      this.loading.set(false);
    }
  }
}
