// pages/api/webhooks/stripe.js
import { buffer } from 'micro';
import Stripe from 'stripe';
import { PrismaClient } from '@prisma/client';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const prisma = new PrismaClient();

// Disable body parsing, we need the raw body for Stripe signature verification
export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  const buf = await buffer(req);
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  
  let event;

  try {
    if (!sig || !webhookSecret) {
      return res.status(400).json({ error: 'Missing Stripe signature or webhook secret' });
    }

    // Verify the event with Stripe
    event = stripe.webhooks.constructEvent(buf, sig, webhookSecret);
  } catch (err) {
    console.error(`Webhook Error: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    // Handle the event
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const reservationId = session.metadata.reservationId;

        if (!reservationId) {
          console.error('No reservation ID in session metadata');
          return res.status(400).json({ error: 'Missing reservation ID' });
        }

        // Update the reservation status to CONFIRMED
        await prisma.reservation.update({
          where: { id: reservationId },
          data: {
            status: 'CONFIRMED',
            paymentId: session.payment_intent,
            paidAt: new Date(),
          },
        });

        console.log(`Payment successful for reservation ${reservationId}`);
        break;
      }

      case 'checkout.session.expired': {
        const session = event.data.object;
        const reservationId = session.metadata.reservationId;

        if (!reservationId) {
          console.error('No reservation ID in session metadata');
          return res.status(400).json({ error: 'Missing reservation ID' });
        }

        // Get the reservation to find associated seats
        const reservation = await prisma.reservation.findUnique({
          where: { id: reservationId },
          include: {
            reservedSeats: true,
          },
        });

        if (!reservation) {
          console.error(`Reservation ${reservationId} not found`);
          return res.status(404).json({ error: 'Reservation not found' });
        }

        // Release the seats back to available
        const seatIds = reservation.reservedSeats.map(rs => rs.seatId);
        await prisma.seat.updateMany({
          where: {
            id: { in: seatIds },
          },
          data: {
            available: true,
          },
        });

        // Update reservation status
        await prisma.reservation.update({
          where: { id: reservationId },
          data: { status: 'EXPIRED' },
        });

        console.log(`Session expired for reservation ${reservationId}`);
        break;
      }

      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error(`Webhook handler failed: ${error.message}`);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
}
