import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { TrackingService } from './tracking.service';
import { TrackingNotifierService } from './tracking-notifier.service';
import { OptOutDto } from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators';

/**
 * Tracking Controller
 *
 * Note the guards: the `public/*` routes carry none, on purpose. That is the
 * whole point of the feature — a relative opens a link in whatever browser they
 * have, with no account and no app. The 192-bit token in the URL is the only
 * credential, and TrackingService decides on every read whether it still works.
 */
@Controller('tracking')
export class TrackingController {
  constructor(
    private readonly trackingService: TrackingService,
    private readonly trackingNotifier: TrackingNotifierService,
  ) {}

  /**
   * The live case view behind a shared link. No authentication.
   * 404 for a token that never existed, 410 once the case has ended.
   */
  @Get('public/:token')
  async getPublicView(@Param('token') token: string) {
    return this.trackingService.getPublicView(token);
  }

  /** Whether the contact who received this link is still subscribed. */
  @Get('public/opt-out/:optOutToken')
  async getOptOutState(@Param('optOutToken') optOutToken: string) {
    return this.trackingNotifier.getOptOutState(optOutToken);
  }

  /** The contact's own unsubscribe (or re-subscribe), straight from the page. */
  @Post('public/opt-out/:optOutToken')
  async setOptOut(@Param('optOutToken') optOutToken: string, @Body() body: OptOutDto) {
    return this.trackingNotifier.setOptOut(optOutToken, body.optOut ?? true);
  }

  /**
   * The patient's own share sheet: the link for this case, who has already been
   * alerted, and how often it has been opened.
   */
  @Get('bookings/:bookingId')
  @UseGuards(JwtAuthGuard)
  async getShareInfo(@Param('bookingId') bookingId: string, @CurrentUser() user: any) {
    return this.trackingService.getShareInfo(bookingId, user);
  }
}
