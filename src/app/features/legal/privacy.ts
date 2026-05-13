import { Component, ChangeDetectionStrategy } from '@angular/core';
import { Location } from '@angular/common';
import { inject } from '@angular/core';

@Component({
  selector: 'app-privacy',
  templateUrl: './privacy.html',
  styleUrl: './privacy.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Privacy {
  private location = inject(Location);

  goBack() {
    this.location.back();
  }
}
