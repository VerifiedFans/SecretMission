// pages/api/create-checkout-session.js
import Stripe from 'stripe';
import { PrismaClient } from '@prisma/client';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const prisma = new PrismaClient();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  try {
    const { reservationId } = req.body;

    if (!reservationId) {
      return res.status(400).json({ error: 'Reservation ID is required' });
    }

    // Get reservation details
    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: {
        reservedSeats: {
          include: {
            seat: true,
          },
        },
      },
    });

    if (!reservation) {
      return res.status(404).json({ error: 'Reservation not found' });
    }

    if (reservation.status !== 'PENDING') {
      return res.status(400).json({ error: `Reservation status is ${reservation.status}` });
    }

    // Format line items for Stripe
    const lineItems = reservation.reservedSeats.map(reservedSeat => ({
      price_data: {
        currency: 'usd',
        product_data: {
          name: `Seat ${reservedSeat.seat.section}${reservedSeat.seat.row}-${reservedSeat.seat.number}`,
          description: `Section ${reservedSeat.seat.section}, Row ${reservedSeat.seat.row}, Seat ${reservedSeat.seat.number}`,
        },
        unit_amount: reservedSeat.seat.price * 100, // Convert to cents
      },
      quantity: 1,
    }));

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      success_url: `${process.env.NEXT_PUBLIC_BASE_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_BASE_URL}/checkout/cancel?reservation_id=${reservationId}`,
      client_reference_id: reservationId,
      customer_email: reservation.email,
      metadata: {
        reservationId: reservationId,
      },
    });

    // Update reservation with checkout session ID
    await prisma.reservation.update({
      where: { id: reservationId },
      data: {
        checkoutSessionId: session.id,
      },
    });

    res.status(200).json({ sessionId: session.id, sessionUrl: session.url });
  } catch (error) {
    console.error('Stripe checkout error:', error);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
}
