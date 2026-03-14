import { Component, inject, viewChild, ElementRef, effect, signal } from '@angular/core';
import {
  IonContent, IonButton, IonIcon, IonSpinner, IonInput
} from '@ionic/angular/standalone';
import { NavController } from '@ionic/angular/standalone';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { LiveStoryFacade } from '../../../application/facades/live-story.facade';
import { addIcons } from 'ionicons';
import {
  close, mic, micOff, stop, happy, alertCircle, bookOutline, refresh
} from 'ionicons/icons';

@Component({
  selector: 'app-live',
  standalone: true,
  imports: [IonContent, IonButton, IonIcon, IonSpinner, IonInput],
  templateUrl: './live.page.html',
  styleUrls: ['./live.page.scss']
})
export class LivePage {
  readonly facade = inject(LiveStoryFacade);
  private readonly navCtrl = inject(NavController);
  private readonly route = inject(ActivatedRoute);

  readonly videoRef = viewChild<ElementRef<HTMLVideoElement>>('previewVideo');
  private readonly cameraStream = toSignal(this.facade.cameraStream$);

  readonly childName = signal<string>('');

  constructor() {
    addIcons({ close, mic, micOff, stop, happy, alertCircle, bookOutline, refresh });

    effect(() => {
      const stream = this.cameraStream();
      const videoEl = this.videoRef()?.nativeElement;
      if (stream && videoEl) {
        videoEl.srcObject = stream;
        videoEl.muted = true;
        videoEl.play().catch(() => { /* autoplay blocked */ });
      }
    });

    this.facade.startPreview();
  }

  start(): void {
    const params = this.route.snapshot.queryParams;
    const topic: string = params['topic'];
    const agentId: string = params['agentId'];
    const name = this.childName().trim() || 'Pequeño Aventurero';

    if (topic && agentId) {
      this.facade.startStorytelling(name, topic, agentId);
    } else {
      this.facade.startStorytelling(name, '', 'narrator-onboarding');
    }
  }

  stop(): void {
    this.facade.endStorytelling();
  }
}
